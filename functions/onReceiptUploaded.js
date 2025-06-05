const { VertexAI } = require('@google-cloud/vertexai')
const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2') // 2nd gen logger
// Import 2nd gen specific modules
const { onObjectFinalized } = require('firebase-functions/v2/storage')

const db = admin.firestore()

// Configure Vertex AI
const project = process.env.GCLOUD_PROJECT || admin.instanceId().app.options.projectId // More robust way to get project ID
const location = 'us-west1' // Or your preferred Vertex AI region
const model = 'gemini-2.0-flash-lite' // Or the latest stable vision model

const vertexAI = new VertexAI({ project, location })

// Updated prompt for Gemini
function PROMPT_TEXT(currency) {
  const languageMap = {
    JPY: 'Japanese',
    USD: 'English',
    EUR: 'English',
    GBP: 'English',
    AUD: 'English',
    CAD: 'English',
    CNY: 'Simplified Chinese',
    KRW: 'Korean',
    SGD: 'English',
    HKD: 'English',
    TWD: 'Traditional Chinese',
  }

  const language = languageMap[currency] || 'English'

  return `
Analyze the provided receipt image and extract the following information.
Return the information strictly as a JSON object. Do not include any explanatory text before or after the JSON.
The JSON object should have the following structure:

{
  "grandTotal": <number | null>,
  "paidAtString": "<string: YYYY-MM-DD | null>",
  "currency": "${currency || 'null'}",
  "items": [
    {
      "name": "<string>",
      "translatedName": "<string | null>",
      "quantity": <number | null>,
      "price": <number>
    }
  ],
  "description": "<string | null>"
}

Details for extraction:
- For 'grandTotal': The final total amount paid.
- For 'paidAtString': Extract the date and time of purchase from the receipt as a string in YYYY-MM-DD HH:MM format. If unable to extract, use the current server date.
- For 'currency': Currency code (e.g., "JPY", "USD"). For Lawson (Japan), it's "JPY".
- For 'items':
    - List each distinct item.
    - 'name': Primary product name. Exclude quantities (e.g., '5コ', '3マイ'), original prices if discounted, and generic prefixes like "FF " or "Lm" unless part of the product identifier.
    - 'price': Final price paid for that item after any item-specific discounts.
    - 'translatedName': REQUIRED - Translate the item name to ${language}. If the item is already in ${language}, use the same name. Do not leave this field null.
    - 'quantity': Quantity of the item. Default to 1 if not provided.
- For 'description': Generate a concise (1-2 sentences) summary of the purchase. Use phrase for the first sentence to quickly describe the purchase, then details for further clarification but no need to mention the cost here. Mention the store name and type of purchase if identifiable. Example: "Purchase of food and drinks from Lawson."
- If any numeric or date string field cannot be reliably extracted, use 'null'. For arrays, use an empty array. For strings, use 'null' or an empty string.

Please analyze the receipt in its native language if possible, but ensure the response is in ${language}.
`
}

// Define the Cloud Function using onObjectFinalized
exports.analyzeReceiptAndUpdateExpense = onObjectFinalized({
  bucket: process.env.GCLOUD_STORAGE_BUCKET,
  region: 'us-west1',
}, async (event) => {
  const fileBucket = event.data.bucket
  const filePath = event.data.name
  const contentType = event.data.contentType

  logger.info(`New file: ${filePath} in bucket: ${fileBucket}, content type: ${contentType}`)

  const pathRegex = /^trips\/([^/]+)\/expenses\/([^/]+)\/resized\/.*$/
  const match = filePath.match(pathRegex)

  if (!match) {
    logger.log(`File path ${filePath} does not match expected structure. Skipping.`)
    return
  }

  const tripId = match[1]
  const expenseId = match[2]
  logger.info(`Extracted tripId: ${tripId}, expenseId: ${expenseId}`)

  // Fetch trip document to get defaultCurrency
  let defaultCurrency = null
  try {
    const tripDoc = await db.doc(`trips/${tripId}`).get()
    if (tripDoc.exists) {
      defaultCurrency = tripDoc.data().defaultCurrency
      logger.info(`Retrieved defaultCurrency: ${defaultCurrency} from trip document`)
    }
    else {
      logger.warn(`Trip document ${tripId} does not exist`)
      defaultCurrency = 'TWD'
    }
  }
  catch (error) {
    logger.error(`Error fetching trip document: ${error}`)
  }

  if (!contentType || !contentType.startsWith('image/')) {
    logger.log('File is not an image. Skipping analysis.', { contentType })
    const expenseDocRefError = db.doc(`trips/${tripId}/expenses/${expenseId}`)
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
    const textPart = { text: PROMPT_TEXT(defaultCurrency) }
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
        receiptImageUrl: filePath,
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

      const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)
      await expenseDocRef.update(firestoreUpdateData)
      logger.info(`Successfully updated Firestore document: trips/${tripId}/expenses/${expenseId}`)
    }
    catch (jsonError) {
      logger.error('Error parsing JSON from Gemini response:', jsonError)
      logger.error('Raw non-JSON response from Gemini:', { rawResponse: aggregatedResponseText })
      const expenseDocRefFailure = db.doc(`trips/${tripId}/expenses/${expenseId}`)
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

    const expenseDocRefGeneralError = db.doc(`trips/${tripId}/expenses/${expenseId}`)
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
