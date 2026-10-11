const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const {
  getImageAsBase64,
  analyzeReceiptWithAI,
  prepareFirestoreUpdateData,
  getContentTypeFromPath,
} = require('./receiptAnalysis')
const { sortPagePaths } = require('./receiptPages')
const { canModifyExpense } = require('./tripAccess')

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

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to re-analyze receipts')
  }

  // Check access before the try block: its catch writes an error state onto the expense.
  const [tripSnap, collaboratorSnap, expenseSnap] = await Promise.all([
    db.doc(`trips/${tripId}`).get(),
    db.doc(`trips/${tripId}/collaborators/${request.auth.uid}`).get(),
    db.doc(`trips/${tripId}/expenses/${expenseId}`).get(),
  ])
  const allowed = canModifyExpense({
    uid: request.auth.uid,
    trip: tripSnap.exists ? tripSnap.data() : null,
    collaborator: collaboratorSnap.exists ? collaboratorSnap.data() : null,
    expense: expenseSnap.exists ? expenseSnap.data() : null,
  })
  if (!allowed) {
    throw new HttpsError('permission-denied', 'You cannot modify this expense')
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

    // Expenses created before multi-page upload have only receiptImageUrl.
    const storedPages = Array.isArray(expenseData.imageUrls) ? expenseData.imageUrls : []
    const pagePaths = storedPages.length > 0
      ? sortPagePaths(storedPages)
      : (expenseData.receiptImageUrl ? [expenseData.receiptImageUrl] : [])

    if (pagePaths.length === 0) {
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

    logger.info(`Downloading ${pagePaths.length} page(s): ${pagePaths.join(', ')}`)

    // Download every page from Storage using default bucket
    const bucketName = storageBucket.name
    const pages = await Promise.all(pagePaths.map(async path => ({
      base64: await getImageAsBase64(bucketName, path),
      contentType: getContentTypeFromPath(path),
    })))

    logger.info(`${pages.length} page(s) downloaded`)

    // Analyze with AI — several pages are read as one continuous receipt
    const parsedDataFromAI = await analyzeReceiptWithAI(
      pages,
      tripCurrency,
      defaultCurrency,
    )
    logger.info('Successfully parsed receipt data:', parsedDataFromAI)

    // Prepare update data (don't update receiptImageUrl since it's the same).
    // Preserve an existing category so re-analysis never overwrites a manual choice.
    const firestoreUpdateData = prepareFirestoreUpdateData(parsedDataFromAI, tripCurrency, null, {
      preserveCategory: !!expenseData.category,
    })

    // Update Firestore
    await expenseDocRef.update(firestoreUpdateData)
    logger.info(`Successfully updated expense: trips/${tripId}/expenses/${expenseId}`)

    // Structured outcome event — query reliability via jsonPayload.event
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'success',
      mode: 'reanalyze',
      tripId,
      expenseId,
      pageCount: pages.length,
      itemCount: parsedDataFromAI.items?.length ?? 0,
      needsReview: parsedDataFromAI.needsReview ?? false,
      currency: parsedDataFromAI.currency ?? null,
    })

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
    logger.info('receipt_extraction', {
      event: 'receipt_extraction',
      status: 'fail',
      mode: 'reanalyze',
      reason: error instanceof HttpsError ? error.code : 'ai_error',
      tripId,
      expenseId,
      error: error.message || 'Unknown error',
    })

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
