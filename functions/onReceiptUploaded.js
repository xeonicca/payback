const { VertexAI } = require('@google-cloud/vertexai')
const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2') // 2nd gen logger
// Import 2nd gen specific modules
const { onObjectFinalized } = require('firebase-functions/v2/storage')

const db = admin.firestore()

// Configure Vertex AI
const project = process.env.GCLOUD_PROJECT || admin.instanceId().app.options.projectId // More robust way to get project ID
const location = 'us-west1' // Or your preferred Vertex AI region
const model = 'gemini-1.0-pro-vision-001' // Or the latest stable vision model

const vertexAI = new VertexAI({ project, location })

// Updated prompt for Gemini
const PROMPT_TEXT = `
Analyze the provided receipt image and extract the following information.
Return the information strictly as a JSON object. Do not include any explanatory text before or after the JSON.
The JSON object should have the following structure:

{
  "grandTotal": <number | null>,
  "paidAtString": "<string: YYYY-MM-DD | null>",
  "currency": "<string | null>",
  "items": [
    {
      "name": "<string>",
      "price": <number>
    }
  ],
  "description": "<string | null>"
}

Details for extraction:
- For 'grandTotal': The final total amount paid.
- For 'paidAtString': Extract the date of purchase from the receipt as a string in YYYY-MM-DD format. Ignore time.
- For 'currency': Currency code (e.g., "JPY", "USD"). For Lawson (Japan), it's "JPY".
- For 'items':
    - List each distinct item.
    - 'name': Primary product name. Exclude quantities (e.g., '5コ', '3マイ'), original prices if discounted, and generic prefixes like "FF " or "Lm" unless part of the product identifier.
    - 'price': Final price paid for that item after any item-specific discounts.
- For 'description': Generate a concise (1-2 sentences) summary of the purchase. Mention the store name if identifiable. Example: "Purchase of food and drinks from Lawson."
- If any numeric or date string field cannot be reliably extracted, use 'null'. For arrays, use an empty array. For strings, use 'null' or an empty string.
`

// Define the Cloud Function using onObjectFinalized
exports.analyzeReceiptAndUpdateExpense = onObjectFinalized({
  bucket: process.env.GCLOUD_STORAGE_BUCKET, // Or your specific bucket name if not default
  // You can add other options like memory, timeoutSeconds, cpu, region etc. here
  region: 'us-west1', // Example
}, async (event) => {
  const fileBucket = event.data.bucket // Bucket that contains the file.
  const filePath = event.data.name // File path in the bucket.
  const contentType = event.data.contentType // File content type.

  logger.info(`New file: ${filePath} in bucket: ${fileBucket}, content type: ${contentType}`)

  const pathRegex = /^trips\/([^/]+)\/expenses\/([^/]+)\/resized\/.*$/
  const match = filePath.match(pathRegex)

  if (!match) {
    logger.log(`File path ${filePath} does not match expected structure. Skipping.`)
    return // In 2nd gen, just return to signify completion.
  }

  const tripId = match[1]
  const expenseId = match[2]
  logger.info(`Extracted tripId: ${tripId}, expenseId: ${expenseId}`)

  if (!contentType || !contentType.startsWith('image/')) {
    logger.log('File is not an image. Skipping analysis.', { contentType })
    const expenseDocRefError = db.doc(`trips/${tripId}/expense/${expenseId}`)
    try {
      await expenseDocRefError.update({
        isProcessing: false,
        processingError: 'Uploaded file was not a valid image.',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    catch (error) {
      logger.error(`Error updating Firestore for non-image file: ${expenseId}`, error)
    }
    return
  }

  const gcsImageUri = `gs://${fileBucket}/${filePath}`
  logger.info(`Analyzing image: ${gcsImageUri}`)

  try {
    const generativeModel = vertexAI.getGenerativeModel({ model })
    const imagePart = { fileData: { mimeType: contentType, fileUri: gcsImageUri } }
    const textPart = { text: PROMPT_TEXT }
    const request = { contents: [{ role: 'user', parts: [imagePart, textPart] }] }

    logger.log('Sending request to Gemini API...')
    const streamingResp = await generativeModel.generateContentStream(request)

    let aggregatedResponseText = ''
    for await (const item of streamingResp.stream) {
      if (item.candidates && item.candidates[0].content && item.candidates[0].content.parts) {
        item.candidates[0].content.parts.forEach((part) => {
          if (part.text)
            aggregatedResponseText += part.text
        })
      }
    }
    logger.info('Gemini API raw response received:', { text: aggregatedResponseText }) // Log as object for better viewing

    let jsonString = aggregatedResponseText.trim()
    if (jsonString.startsWith('```json'))
      jsonString = jsonString.substring(7)
    if (jsonString.endsWith('```'))
      jsonString = jsonString.substring(0, jsonString.length - 3)
    jsonString = jsonString.trim()

    let parsedDataFromAI
    try {
      parsedDataFromAI = JSON.parse(jsonString)
      logger.info('Successfully parsed JSON from Gemini:', parsedDataFromAI)

      let paidAtTimestamp = null
      if (parsedDataFromAI.paidAtString) {
        try {
          // Ensure the date string includes time if needed, or parse as local date
          // new Date('YYYY-MM-DD') is interpreted as UTC. For local date midnight:
          const dateParts = parsedDataFromAI.paidAtString.split('-')
          if (dateParts.length === 3) {
            const year = Number.parseInt(dateParts[0], 10)
            const month = Number.parseInt(dateParts[1], 10) - 1 // JS months are 0-indexed
            const day = Number.parseInt(dateParts[2], 10)
            const dateObj = new Date(year, month, day)
            if (!Number.isNaN(dateObj.getTime())) {
              paidAtTimestamp = admin.firestore.Timestamp.fromDate(dateObj)
            }
            else {
              logger.warn('Invalid date components from paidAtString:', parsedDataFromAI.paidAtString)
            }
          }
          else {
            logger.warn('paidAtString not in YYYY-MM-DD format:', parsedDataFromAI.paidAtString)
          }
        }
        catch (dateError) {
          logger.error('Error converting paidAtString to Date object:', dateError)
        }
      }

      const { paidAtString, ...restOfData } = parsedDataFromAI
      const firestoreUpdateData = {
        ...restOfData,
        isProcessing: false,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processingError: null,
      }

      if (paidAtTimestamp !== null) {
        firestoreUpdateData.paidAt = paidAtTimestamp
      }
      else {
        // Optionally, explicitly set to null if you want that in Firestore
        // firestoreUpdateData.paidAt = null;
        // Or, if you want the field to be absent if not found, do nothing here.
        logger.warn('paidAtTimestamp is null, \'paidAt\' field will not be set or will be explicitly null if uncommented.')
      }

      const expenseDocRef = db.doc(`trips/${tripId}/expense/${expenseId}`)
      await expenseDocRef.update(firestoreUpdateData)
      logger.info(`Successfully updated Firestore document: trips/${tripId}/expense/${expenseId}`)
    }
    catch (jsonError) {
      logger.error('Error parsing JSON from Gemini response:', jsonError)
      logger.error('Raw non-JSON response from Gemini:', { rawResponse: aggregatedResponseText })
      const expenseDocRefFailure = db.doc(`trips/${tripId}/expense/${expenseId}`)
      try {
        await expenseDocRefFailure.update({
          isProcessing: false,
          processingError: 'Failed to parse receipt data from AI.',
          rawAiResponse: aggregatedResponseText,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      catch (updateError) {
        logger.error(`Error updating Firestore with parsing failure for ${expenseId}`, updateError)
      }
    }
  }
  catch (error) {
    logger.error('Error calling Gemini API or general processing error:', error)
    if (error.response)
      logger.error('Gemini API Error Response:', error.response.data)

    const expenseDocRefGeneralError = db.doc(`trips/${tripId}/expense/${expenseId}`)
    try {
      await expenseDocRefGeneralError.update({
        isProcessing: false,
        processingError: `AI processing failed: ${error.message || 'Unknown error'}.`,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    catch (updateError) {
      logger.error(`Error updating Firestore with general failure for ${expenseId}`, updateError)
    }
  }
  // In 2nd gen, simply returning (or returning a promise that resolves) signals completion.
})
