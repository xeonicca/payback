const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2')
const { onObjectFinalized } = require('firebase-functions/v2/storage')
const {
  getImageAsBase64,
  analyzeReceiptWithAI,
  prepareFirestoreUpdateData,
} = require('./receiptAnalysis')

const db = admin.firestore()

// Define the Cloud Function
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

  let tripCurrency = null
  let defaultCurrency = null
  try {
    const tripDoc = await db.doc(`trips/${tripId}`).get()
    if (tripDoc.exists) {
      const tripData = tripDoc.data()
      tripCurrency = tripData.tripCurrency
      defaultCurrency = tripData.defaultCurrency
    }
    else {
      logger.warn(`Trip document ${tripId} does not exist`)
      tripCurrency = 'TWD'
      defaultCurrency = 'TWD'
    }
  }
  catch (error) {
    logger.error(`Error fetching trip document: ${error}`)
    tripCurrency = 'TWD'
    defaultCurrency = 'TWD'
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
    catch (err) { logger.error(err) }
    return
  }

  logger.info(`Analyzing image: ${filePath}`)

  try {
    const imageBase64 = await getImageAsBase64(fileBucket, filePath)

    // Analyze with AI (includes price sanitization)
    const parsedDataFromAI = await analyzeReceiptWithAI(
      imageBase64,
      contentType,
      tripCurrency,
      defaultCurrency,
    )
    logger.info('Successfully parsed receipt data:', parsedDataFromAI)

    // Prepare Firestore update data
    const firestoreUpdateData = prepareFirestoreUpdateData(
      parsedDataFromAI,
      tripCurrency,
      filePath, // receiptImageUrl
    )

    const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)
    await expenseDocRef.update(firestoreUpdateData)
    logger.info(`Successfully updated Firestore document: trips/${tripId}/expenses/${expenseId}`)
  }
  catch (error) {
    logger.error('Error calling Gemini API or processing:', error)
    const expenseDocRefGeneralError = db.doc(`trips/${tripId}/expenses/${expenseId}`)
    try {
      await expenseDocRefGeneralError.update({
        isProcessing: false,
        processingError: `AI processing failed: ${error.message || 'Unknown error'}.`,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    catch (updateError) { logger.error(updateError) }
  }
})
