const { Storage } = require('@google-cloud/storage')
const { GoogleGenAI } = require('@google/genai')
const dayjs = require('dayjs')
const customParseFormat = require('dayjs/plugin/customParseFormat')
const timezone = require('dayjs/plugin/timezone')
const utc = require('dayjs/plugin/utc')
const admin = require('firebase-admin')
const { logger } = require('firebase-functions/v2')
const { z } = require('zod')
const { zodToJsonSchema } = require('zod-to-json-schema')

// Extend dayjs with timezone support
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const storage = new Storage()

// Define Zod schemas with enhanced descriptions for better AI extraction
const expenseItemSchema = z.object({
  name: z.string().describe('Primary product name of the item. Remove generic prefixes like "FF " or "Lm".'),
  translatedName: z.string().nullable().describe('The name translated into the target language ONLY. Do NOT include the original name. If already in target language, use original.'),
  quantity: z.number().nullable().describe('Count of items. Default to 1 if not specified.'),
  price: z.number().describe('The price per SINGLE unit. CAUTION: If the receipt says "2 @ 10.00 = 20.00", the price is 10.00, NOT 20.00. Do not include currency symbols.'),
})

const receiptSchema = z.object({
  grandTotal: z.number().nullable().describe('The final total amount paid including tax.'),
  paidAtString: z.string().nullable().describe('Date and time of purchase in YYYY-MM-DD HH:mm format.'),
  currency: z.string().describe('Currency code (e.g., JPY, USD, TWD).'),
  items: z.array(expenseItemSchema).describe('List of items purchased.'),
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

// Language map based on currency
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

// Date format based on currency (used for parsing ambiguous dates)
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

/**
 * Generate prompt text for receipt analysis
 * @param {string} receiptCurrency - the expected currency of the receipt (tripCurrency - where the trip is)
 * @param {string} outputLocale - the user's preferred locale for translations (defaultCurrency - user's home currency)
 * @returns {string} The generated prompt
 */
function generatePrompt(receiptCurrency, outputLocale) {
  const language = languageMap[outputLocale] || 'English'
  const dateFormat = dateFormatMap[receiptCurrency] || 'DD/MM/YYYY'

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

/**
 * Download image from GCS and convert to base64
 * @param {string} bucketName - The GCS bucket name
 * @param {string} filePath - The file path in the bucket
 * @returns {Promise<string>} Base64 encoded image data
 */
async function getImageAsBase64(bucketName, filePath) {
  const bucket = storage.bucket(bucketName)
  const file = bucket.file(filePath)
  const [buffer] = await file.download()
  return buffer.toString('base64')
}

/**
 * Sanitize item prices to fix common AI extraction mistakes
 * Catches cases where AI extracts line total instead of unit price
 * @param {object} parsedData - Parsed receipt data from AI
 * @returns {object} Sanitized receipt data
 */
function sanitizeItemPrices(parsedData) {
  if (!parsedData.items || parsedData.items.length === 0) {
    return parsedData
  }

  parsedData.items = parsedData.items.map((item) => {
    // If Price > Grand Total (and Grand Total exists), it's definitely wrong
    // This catches cases where AI grabbed line total instead of unit price
    if (parsedData.grandTotal && item.price > parsedData.grandTotal) {
      if (item.quantity && item.quantity > 1) {
        const newPrice = item.price / item.quantity
        logger.info(`Correcting Unit Price logic: Changed ${item.price} to ${newPrice} based on quantity ${item.quantity}`)
        item.price = Number.parseFloat(newPrice.toFixed(2))
      }
    }
    return item
  })

  return parsedData
}

/**
 * Analyze receipt image using Gemini AI
 * @param {string} imageBase64 - Base64 encoded image data
 * @param {string} contentType - Image MIME type
 * @param {string} tripCurrency - The trip destination currency
 * @param {string} defaultCurrency - The user's default currency
 * @returns {Promise<object>} Parsed receipt data from AI
 */
async function analyzeReceiptWithAI(imageBase64, contentType, tripCurrency, defaultCurrency) {
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

  const parsedData = JSON.parse(result.text)

  // Apply price sanitization to catch AI extraction mistakes
  return sanitizeItemPrices(parsedData)
}

/**
 * Convert paidAtString to Firestore Timestamp with correct timezone
 * @param {string|null} paidAtString - Date string in YYYY-MM-DD HH:mm format
 * @param {string} tripCurrency - The trip destination currency (for timezone)
 * @returns {admin.firestore.Timestamp|null} Firestore Timestamp or null
 */
function convertToTimestamp(paidAtString, tripCurrency) {
  if (!paidAtString) {
    return null
  }

  try {
    const tz = timezoneMap[tripCurrency] || 'UTC'
    const parsedDate = dayjs.tz(paidAtString, 'YYYY-MM-DD HH:mm', tz)

    if (parsedDate.isValid()) {
      const timestamp = admin.firestore.Timestamp.fromDate(parsedDate.toDate())
      logger.info('Successfully converted paidAtString to Timestamp:', {
        original: paidAtString,
        timezone: tz,
        timestamp,
        utc: parsedDate.utc().format(),
      })
      return timestamp
    }
    else {
      logger.warn('Invalid date format from paidAtString:', paidAtString)
      return null
    }
  }
  catch (dateError) {
    logger.error('Error converting paidAtString to Date object:', dateError)
    return null
  }
}

/**
 * Prepare Firestore update data from AI response
 * @param {object} parsedDataFromAI - Parsed data from Gemini AI
 * @param {string} tripCurrency - The trip destination currency
 * @param {string|null} receiptImageUrl - Optional receipt image URL to include
 * @returns {object} Data ready for Firestore update
 */
function prepareFirestoreUpdateData(parsedDataFromAI, tripCurrency, receiptImageUrl = null) {
  const paidAtTimestamp = convertToTimestamp(parsedDataFromAI.paidAtString, tripCurrency)

  const { paidAtString, ...restOfData } = parsedDataFromAI
  const firestoreUpdateData = {
    ...restOfData,
    isProcessing: false,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingError: null,
  }

  if (receiptImageUrl !== null) {
    firestoreUpdateData.receiptImageUrl = receiptImageUrl
  }

  if (paidAtTimestamp !== null) {
    firestoreUpdateData.paidAt = paidAtTimestamp
  }
  else {
    logger.warn('paidAtTimestamp is null, \'paidAt\' field will not be set.')
  }

  return firestoreUpdateData
}

/**
 * Get content type from file extension
 * @param {string} filePath - The file path
 * @returns {string} The MIME type
 */
function getContentTypeFromPath(filePath) {
  const extension = filePath.split('.').pop().toLowerCase()
  const mimeTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  }
  return mimeTypes[extension] || 'image/jpeg'
}

module.exports = {
  generatePrompt,
  getImageAsBase64,
  analyzeReceiptWithAI,
  sanitizeItemPrices,
  convertToTimestamp,
  prepareFirestoreUpdateData,
  getContentTypeFromPath,
  timezoneMap,
  languageMap,
  dateFormatMap,
  receiptSchema,
  expenseItemSchema,
}
