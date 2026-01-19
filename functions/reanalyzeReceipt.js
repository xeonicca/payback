const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const {
  getImageAsBase64,
  analyzeReceiptWithAI,
  prepareFirestoreUpdateData,
  getContentTypeFromPath,
} = require('./receiptAnalysis')

const db = admin.firestore()
const storageBucket = admin.storage().bucket()

/**
 * Callable Cloud Function to re-analyze an existing receipt image
 * Accepts { tripId, expenseId } and re-runs AI analysis on the stored receipt image
 */
exports.reanalyzeReceipt = onCall({
  region: 'us-west1',
}, async (request) => {
  const { tripId, expenseId } = request.data

  // Validate input
  if (!tripId || typeof tripId !== 'string') {
    throw new HttpsError('invalid-argument', 'tripId is required and must be a string')
  }
  if (!expenseId || typeof expenseId !== 'string') {
    throw new HttpsError('invalid-argument', 'expenseId is required and must be a string')
  }

  logger.info(`Re-analyzing receipt for trip: ${tripId}, expense: ${expenseId}`)

  try {
    // Fetch trip document to get tripCurrency and defaultCurrency
    const tripDoc = await db.doc(`trips/${tripId}`).get()
    if (!tripDoc.exists) {
      throw new HttpsError('not-found', `Trip ${tripId} not found`)
    }

    const tripData = tripDoc.data()
    const tripCurrency = tripData.tripCurrency || 'TWD'
    const defaultCurrency = tripData.defaultCurrency || 'TWD'
    logger.info(`Trip currencies - tripCurrency: ${tripCurrency}, defaultCurrency: ${defaultCurrency}`)

    // Fetch expense document to get receiptImageUrl
    const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)
    const expenseDoc = await expenseDocRef.get()
    if (!expenseDoc.exists) {
      throw new HttpsError('not-found', `Expense ${expenseId} not found`)
    }

    const expenseData = expenseDoc.data()
    const receiptImageUrl = expenseData.receiptImageUrl

    if (!receiptImageUrl) {
      throw new HttpsError('failed-precondition', 'Expense does not have a receipt image')
    }

    // Check if already processing
    if (expenseData.isProcessing) {
      throw new HttpsError('already-exists', 'Receipt is already being processed')
    }

    // Set isProcessing to true before starting
    await expenseDocRef.update({
      isProcessing: true,
      processingError: null,
    })

    logger.info(`Downloading image from: ${receiptImageUrl}`)

    // Download image from Storage using default bucket
    const bucketName = storageBucket.name
    const imageBase64 = await getImageAsBase64(bucketName, receiptImageUrl)
    const contentType = getContentTypeFromPath(receiptImageUrl)

    logger.info(`Image downloaded, content type: ${contentType}`)

    // Analyze with AI
    const parsedDataFromAI = await analyzeReceiptWithAI(
      imageBase64,
      contentType,
      tripCurrency,
      defaultCurrency,
    )
    logger.info('Successfully parsed receipt data:', parsedDataFromAI)

    // Prepare update data (don't update receiptImageUrl since it's the same)
    const firestoreUpdateData = prepareFirestoreUpdateData(parsedDataFromAI, tripCurrency)

    // Update Firestore
    await expenseDocRef.update(firestoreUpdateData)
    logger.info(`Successfully updated expense: trips/${tripId}/expenses/${expenseId}`)

    return {
      success: true,
      message: 'Receipt re-analyzed successfully',
      data: {
        grandTotal: parsedDataFromAI.grandTotal,
        currency: parsedDataFromAI.currency,
        itemCount: parsedDataFromAI.items?.length || 0,
        description: parsedDataFromAI.description,
      },
    }
  }
  catch (error) {
    logger.error('Error re-analyzing receipt:', error)

    // Update Firestore with error state
    try {
      const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)
      await expenseDocRef.update({
        isProcessing: false,
        processingError: `Re-analysis failed: ${error.message || 'Unknown error'}`,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    catch (updateError) {
      logger.error('Error updating Firestore with failure state:', updateError)
    }

    // Re-throw HttpsError as-is, wrap others
    if (error instanceof HttpsError) {
      throw error
    }
    throw new HttpsError('internal', `Failed to re-analyze receipt: ${error.message}`)
  }
})
