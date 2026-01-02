const { GoogleGenAI } = require('@google/genai')
const { z } = require('zod')
const { zodToJsonSchema } = require('zod-to-json-schema')
const { Storage } = require('@google-cloud/storage')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const customParseFormat = require('dayjs/plugin/customParseFormat')
const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2')
const { onObjectFinalized } = require('firebase-functions/v2/storage')

// Extend dayjs with timezone support
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const db = admin.firestore()
const storage = new Storage()

// Define Zod schemas
const expenseItemSchema = z.object({
  name: z.string().describe('Primary product name of the item.'),
  translatedName: z.string().nullable().describe('Translated name of the item in the target language.'),
  quantity: z.number().nullable().describe('Quantity of the item. Default to 1 if not provided.'),
  price: z.number().describe('Final price paid for that item after any item-specific discounts.'),
})

const receiptSchema = z.object({
  grandTotal: z.number().nullable().describe('The final total amount paid.'),
  paidAtString: z.string().nullable().describe('Date and time of purchase in YYYY-MM-DD HH:mm format.'),
  currency: z.string().describe('Currency code (e.g., JPY, USD, TWD).'),
  items: z.array(expenseItemSchema).describe('List of items purchased.'),
  description: z.string().nullable().describe('Concise 1-2 sentence summary of the purchase.'),
})

// Configure Google Gen AI
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })

// Timezone map based on currency
const timezoneMap = {
  JPY: 'Asia/Tokyo',
  CNY: 'Asia/Shanghai',
  KRW: 'Asia/Seoul',
  TWD: 'Asia/Taipei',
  HKD: 'Asia/Hong_Kong',
  SGD: 'Asia/Singapore',
  MYR: 'Asia/Kuala_Lumpur',
  THB: 'Asia/Bangkok',
  IDR: 'Asia/Jakarta',
  VND: 'Asia/Ho_Chi_Minh',
  PHP: 'Asia/Manila',
  USD: 'America/New_York', // Default to Eastern Time
  CAD: 'America/Toronto',
  EUR: 'Europe/Paris', // Default to Central European Time
  GBP: 'Europe/London',
  AUD: 'Australia/Sydney',
  NZD: 'Pacific/Auckland',
  INR: 'Asia/Kolkata',
}

// Generate prompt text
function generatePrompt(currency) {
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

  // Date format guidance based on currency
  const dateFormatMap = {
    USD: 'MM/DD/YYYY (US format)',
    JPY: 'YYYY/MM/DD or YYYY-MM-DD (Japanese format)',
    CNY: 'YYYY/MM/DD or YYYY-MM-DD (Chinese format)',
    KRW: 'YYYY/MM/DD or YYYY-MM-DD (Korean format)',
    EUR: 'DD/MM/YYYY (European format)',
    GBP: 'DD/MM/YYYY (UK format)',
    AUD: 'DD/MM/YYYY (Australian format)',
    CAD: 'DD/MM/YYYY or MM/DD/YYYY (Canadian format - use context clues)',
    SGD: 'DD/MM/YYYY (Singapore format)',
    HKD: 'DD/MM/YYYY (Hong Kong format)',
    TWD: 'YYYY/MM/DD (Taiwanese format)',
    MYR: 'DD/MM/YYYY (Malaysian format)',
    THB: 'DD/MM/YYYY (Thai format)',
    IDR: 'DD/MM/YYYY (Indonesian format)',
    VND: 'DD/MM/YYYY (Vietnamese format)',
    PHP: 'MM/DD/YYYY (Philippine format)',
  }

  const language = languageMap[currency] || 'English'
  const dateFormat = dateFormatMap[currency] || 'DD/MM/YYYY (international format)'

  return `
Analyze the provided receipt image and extract the following information:

Details for extraction:
- For 'grandTotal': The final total amount paid.
- For 'paidAtString': Extract the date and time of purchase from the receipt.
  IMPORTANT DATE PARSING INSTRUCTIONS:
  * The receipt is from a ${currency} currency region, which typically uses ${dateFormat}.
  * Use this knowledge to interpret ambiguous dates correctly (e.g., "05/03/2024" should be interpreted based on regional format).
  * For dates like "13/03/2024", it's clear that 13 is the day (since months only go to 12).
  * For ambiguous dates like "05/03/2024", use the regional format: ${dateFormat}.
  * Always output the final date in YYYY-MM-DD HH:mm format, regardless of the input format.
  * If you cannot extract a valid date, use null.
- For 'currency': Currency code should be "${currency}".
- For 'items':
    - List each distinct item. If the receipt includes consumer tax or any form of discount from the grand total, also include it in the items.
    - 'name': Primary product name. Exclude quantities (e.g., '5コ', '3マイ'), original prices if discounted, and generic prefixes like "FF " or "Lm" unless part of the product identifier.
    - 'price': Final price paid for that item after any item-specific discounts.
    - 'translatedName': REQUIRED - Translate the item name to ${language}. If the item is already in ${language}, use the same name. Do not leave this field null.
    - 'quantity': Quantity of the item. Default to 1 if not provided.
- For 'description': Generate a concise (1-2 sentences) summary of the purchase. Use phrase for the first sentence to quickly describe the purchase, then details for further clarification but no need to mention the cost here. Mention the store name and type of purchase if identifiable.
- If any numeric or date string field cannot be reliably extracted, use null.

Please analyze the receipt in its native language if possible, but ensure the response follows the schema structure.
`
}

// Helper function to download image from GCS and convert to base64
async function getImageAsBase64(bucketName, filePath) {
  const bucket = storage.bucket(bucketName)
  const file = bucket.file(filePath)
  const [buffer] = await file.download()
  return buffer.toString('base64')
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

  logger.info(`Analyzing image: ${filePath}`)

  try {
    // Download image and convert to base64
    const imageBase64 = await getImageAsBase64(fileBucket, filePath)

    // Configure model with structured output
    const model = ai.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: zodToJsonSchema(receiptSchema),
      },
    })

    const imagePart = {
      inlineData: {
        mimeType: contentType,
        data: imageBase64,
      },
    }

    logger.log('Sending request to Gemini API with structured schema...')
    const result = await model.generateContent([
      generatePrompt(defaultCurrency),
      imagePart,
    ])

    // Parse the guaranteed JSON response
    const parsedDataFromAI = JSON.parse(result.response.text())
    logger.info('Successfully parsed receipt data:', parsedDataFromAI)

    // Convert paidAtString to Firestore Timestamp with correct timezone
    let paidAtTimestamp = null
    if (parsedDataFromAI.paidAtString) {
      try {
        // Get the timezone for this currency
        const tz = timezoneMap[defaultCurrency] || 'UTC'

        // Parse the date string in the receipt's local timezone
        const parsedDate = dayjs.tz(parsedDataFromAI.paidAtString, 'YYYY-MM-DD HH:mm', tz)

        if (parsedDate.isValid()) {
          paidAtTimestamp = admin.firestore.Timestamp.fromDate(parsedDate.toDate())
          logger.info('Successfully converted paidAtString to Timestamp:', {
            original: parsedDataFromAI.paidAtString,
            timezone: tz,
            timestamp: paidAtTimestamp,
            utc: parsedDate.utc().format(),
          })
        }
        else {
          logger.warn('Invalid date format from paidAtString:', parsedDataFromAI.paidAtString)
        }
      }
      catch (dateError) {
        logger.error('Error converting paidAtString to Date object:', dateError)
      }
    }

    // Prepare Firestore update data
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
      logger.warn('paidAtTimestamp is null, \'paidAt\' field will not be set.')
    }

    // Update Firestore
    const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)
    await expenseDocRef.update(firestoreUpdateData)
    logger.info(`Successfully updated Firestore document: trips/${tripId}/expenses/${expenseId}`)
  }
  catch (error) {
    logger.error('Error calling Gemini API or processing:', error)
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
})
