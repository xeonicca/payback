const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2')
const { onObjectFinalized } = require('firebase-functions/v2/storage')
const {
  getImageAsBase64,
  analyzeReceiptWithAI,
  prepareFirestoreUpdateData,
  getContentTypeFromPath,
} = require('./receiptAnalysis')
const { claimPageForAnalysis } = require('./receiptPages')

const db = admin.firestore()

// Define the Cloud Function
exports.analyzeReceiptAndUpdateExpense = onObjectFinalized({
  bucket: process.env.GCLOUD_STORAGE_BUCKET,
  region: 'us-west1',
  // A 5-page receipt is 3-5x the items and output tokens of a single photo, and
  // the AI call runs with an unbounded thinking budget. The v2 default of 60s
  // can be exceeded, and a timeout KILLS the container -- so the catch below
  // never runs, no processingError is written, and the expense would sit in
  // the processing state forever.
  timeoutSeconds: 300,
  memory: '512MiB',
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
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'fail',
      reason: 'not_image',
      tripId,
      expenseId,
      contentType: contentType || null,
    })
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

  const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)

  // Each page of a multi-image receipt fires this function separately. The
  // claim decides, atomically, whether this invocation is the one that has the
  // complete set and should run the analysis.
  //
  // The claim must be inside error handling: runTransaction rejects on
  // contention exhaustion or UNAVAILABLE, this trigger is registered without
  // `retry`, and the other invocations have already bailed — so an unhandled
  // rejection means the page is never recorded, nothing re-evaluates the gate,
  // and the expense sits in 處理中 forever with no error written anywhere.
  let claim
  try {
    claim = await claimPageForAnalysis(expenseDocRef, filePath)
  }
  catch (error) {
    logger.error('Failed to record the uploaded page:', error)
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'fail',
      reason: 'claim_error',
      tripId,
      expenseId,
      error: error.message || 'Unknown error',
    })
    // An unrecorded page means the set can never complete, so fail the expense
    // rather than leaving it processing indefinitely.
    try {
      await expenseDocRef.update({
        isProcessing: false,
        processingError: `Could not record an uploaded receipt page: ${error.message || 'Unknown error'}.`,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    catch (updateError) { logger.error(updateError) }
    return
  }

  if (claim.status !== 'analyze') {
    logger.info(`Page ${filePath} recorded with status '${claim.status}' (${claim.paths.length} of ${claim.expected}); not analyzing in this invocation.`)
    return
  }

  logger.info(`Analyzing ${claim.paths.length} page(s): ${claim.paths.join(', ')}`)

  try {
    const pages = await Promise.all(claim.paths.map(async path => ({
      base64: await getImageAsBase64(fileBucket, path),
      // The event's contentType describes only the page that triggered this
      // invocation, so derive each page's type from its own extension.
      contentType: getContentTypeFromPath(path),
    })))

    // Analyze with AI (includes price sanitization)
    const parsedDataFromAI = await analyzeReceiptWithAI(
      pages,
      tripCurrency,
      defaultCurrency,
    )
    logger.info('Successfully parsed receipt data:', parsedDataFromAI)

    // Prepare Firestore update data. The first page in receipt order is the
    // expense's representative image.
    const firestoreUpdateData = prepareFirestoreUpdateData(
      parsedDataFromAI,
      tripCurrency,
      claim.paths[0], // receiptImageUrl
    )

    await expenseDocRef.update(firestoreUpdateData)
    logger.info(`Successfully updated Firestore document: trips/${tripId}/expenses/${expenseId}`)

    // Structured outcome event — query reliability via jsonPayload.event
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'success',
      tripId,
      expenseId,
      pageCount: claim.paths.length,
      itemCount: parsedDataFromAI.items?.length ?? 0,
      needsReview: parsedDataFromAI.needsReview ?? false,
      currency: parsedDataFromAI.currency ?? null,
    })
  }
  catch (error) {
    logger.error('Error calling Gemini API or processing:', error)
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'fail',
      reason: 'ai_error',
      tripId,
      expenseId,
      pageCount: claim.paths.length,
      error: error.message || 'Unknown error',
    })
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
