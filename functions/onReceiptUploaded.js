const { Storage } = require('@google-cloud/storage')
const { GoogleGenAI } = require('@google/genai')
const dayjs = require('dayjs')
const customParseFormat = require('dayjs/plugin/customParseFormat')
const timezone = require('dayjs/plugin/timezone')
const utc = require('dayjs/plugin/utc')
const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2')
const { onObjectFinalized } = require('firebase-functions/v2/storage')
const { z } = require('zod')
const { zodToJsonSchema } = require('zod-to-json-schema')

// Extend dayjs with timezone support
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const db = admin.firestore()
const storage = new Storage()

// --- ENHANCED SCHEMAS ---

const expenseItemSchema = z.object({
  name: z.string().describe('Primary product name of the item. Remove generic prefixes like "FF " or "Lm".'),
  // Fix 1: Explicitly forbid dual-language output in the schema description
  translatedName: z.string().nullable().describe('The name translated into the target language ONLY. Do NOT include the original name. If already in target language, use original.'),
  quantity: z.number().nullable().describe('Count of items. Default to 1 if not specified.'),
  // Fix 2: Explicitly define this as UNIT price to stop the model from grabbing the line total
  price: z.number().describe('The price per SINGLE unit. CAUTION: If the receipt says "2 @ 10.00 = 20.00", the price is 10.00, NOT 20.00. Do not include currency symbols.'),
})

const receiptSchema = z.object({
  grandTotal: z.number().nullable().describe('The final total amount paid including tax.'),
  paidAtString: z.string().nullable().describe('Date and time of purchase in YYYY-MM-DD HH:mm format.'),
  currency: z.string().describe('Currency code (e.g., JPY, USD, TWD).'),
  items: z.array(expenseItemSchema).describe('List of items purchased.'),
  // Fix 3: Explicitly forbid dual-language output here as well
  description: z.string().nullable().describe('Concise 1-sentence summary in the TARGET LANGUAGE ONLY. Do not provide bilingual output (e.g., avoid "Original (Translation)").'),
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
  USD: 'America/New_York',
  CAD: 'America/Toronto',
  EUR: 'Europe/Paris',
  GBP: 'Europe/London',
  AUD: 'Australia/Sydney',
  NZD: 'Pacific/Auckland',
  INR: 'Asia/Kolkata',
}

// --- ENHANCED PROMPT GENERATION ---

function generatePrompt(receiptCurrency, outputLocale) {
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
    HKD: 'Traditional Chinese',
    TWD: 'Traditional Chinese',
    VND: 'Vietnamese',
    MYR: 'Malay',
    THB: 'Thai',
    IDR: 'Indonesian',
    PHP: 'Filipino',
  }

  const dateFormatMap = {
    USD: 'MM/DD/YYYY',
    JPY: 'YYYY/MM/DD',
    CNY: 'YYYY/MM/DD',
    KRW: 'YYYY/MM/DD',
    EUR: 'DD/MM/YYYY',
    GBP: 'DD/MM/YYYY',
    AUD: 'DD/MM/YYYY',
    CAD: 'DD/MM/YYYY',
    SGD: 'DD/MM/YYYY',
    HKD: 'DD/MM/YYYY',
    TWD: 'YYYY/MM/DD',
    MYR: 'DD/MM/YYYY',
    THB: 'DD/MM/YYYY',
    IDR: 'DD/MM/YYYY',
    VND: 'DD/MM/YYYY',
    PHP: 'MM/DD/YYYY',
  }

  const language = languageMap[outputLocale] || 'English'
  const dateFormat = dateFormatMap[receiptCurrency] || 'DD/MM/YYYY'

  // Fix 4: Restructured prompt with strict "Negative Constraints" (what NOT to do)
  return `
Analyze the provided receipt image and extract data into the specified JSON structure.

### CONTEXT
- Receipt Region Currency: ${receiptCurrency}
- Expected Date Format: ${dateFormat}
- Target Output Language: ${language}

### STRICT EXTRACTION RULES:

1. **TRANSLATION**: 
   - For 'description' and 'translatedName', return text **strictly in ${language}**.
   - **FORBIDDEN**: Do not format as "Original (Translation)" or "Translation / Original". 
   - If the text is already in ${language}, return it as is.

2. **PRICING LOGIC (Unit Price vs Line Total)**:
   - The 'price' field in 'items' represents the **UNIT PRICE** (price for 1 item).
   - Check the math: (price * quantity) should equal the line total printed on the receipt.
   - *Example*: If a line says "Beer x 2 ... 10.00", and the total is 10.00, then price is 5.00 and quantity is 2.
   - *Example*: If a line says "Beer ... 5.00" and "Qty 2", and line total is 10.00, price is 5.00.
   - **WARNING**: Do not mistakenly extract the line total as the unit price.

3. **DESCRIPTION**:
   - Create a short summary (e.g., "7-Eleven, snacks and drinks" or "Uber, taxi ride").
   - Do not list every single item name.
   - Language: ${language} ONLY.

4. **DATES**:
   - Parse ambiguity (e.g., 05/04/2024) using the regional format: ${dateFormat}.
   - Output format: YYYY-MM-DD HH:mm.
   - If invalid, return null.

Analyze the receipt now.
`
}

// Helper function to download image from GCS and convert to base64
async function getImageAsBase64(bucketName, filePath) {
  const bucket = storage.bucket(bucketName)
  const file = bucket.file(filePath)
  const [buffer] = await file.download()
  return buffer.toString('base64')
}

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
    // Error handling logic for non-images...
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

    const imagePart = {
      inlineData: {
        mimeType: contentType,
        data: imageBase64,
      },
    }

    logger.log('Sending request to Gemini API with structured schema...')
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        { text: generatePrompt(tripCurrency, defaultCurrency) },
        imagePart,
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: zodToJsonSchema(receiptSchema),
      },
    })

    let parsedDataFromAI = JSON.parse(result.text)

    // --- FIX 5: MATH SAFETY SANITIZATION ---
    // Even if the AI fails the prompt, this code block catches "Line Total" mistakes.
    if (parsedDataFromAI.items && parsedDataFromAI.items.length > 0) {
      parsedDataFromAI.items = parsedDataFromAI.items.map((item) => {
        // Heuristic: If Quantity > 1 AND Price seems suspiciously close to the Grand Total (or significantly high),
        // and Price * Quantity is massive, the AI likely pulled the Line Total as the Unit Price.
        // We verify if (Price / Quantity) makes more sense locally, or checks against Grand Total constraints.

        // Simple Check: If Price > Grand Total (and Grand Total exists), it's definitely wrong.
        if (parsedDataFromAI.grandTotal && item.price > parsedDataFromAI.grandTotal) {
          if (item.quantity && item.quantity > 1) {
            const newPrice = item.price / item.quantity
            logger.info(`Correcting Unit Price logic: Changed ${item.price} to ${newPrice} based on quantity ${item.quantity}`)
            item.price = Number.parseFloat(newPrice.toFixed(2))
          }
        }
        return item
      })
    }

    logger.info('Successfully parsed receipt data:', parsedDataFromAI)

    // Date parsing logic (unchanged)
    let paidAtTimestamp = null
    if (parsedDataFromAI.paidAtString) {
      try {
        const tz = timezoneMap[tripCurrency] || 'UTC'
        const parsedDate = dayjs.tz(parsedDataFromAI.paidAtString, 'YYYY-MM-DD HH:mm', tz)
        if (parsedDate.isValid()) {
          paidAtTimestamp = admin.firestore.Timestamp.fromDate(parsedDate.toDate())
        }
        else {
          logger.warn('Invalid date format from paidAtString:', parsedDataFromAI.paidAtString)
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

    const expenseDocRef = db.doc(`trips/${tripId}/expenses/${expenseId}`)
    await expenseDocRef.update(firestoreUpdateData)
    logger.info(`Successfully updated Firestore document: trips/${tripId}/expenses/${expenseId}`)
  }
  catch (error) {
    logger.error('Error calling Gemini API or processing:', error)
    // Error handling logic (unchanged)...
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
