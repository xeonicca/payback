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

/**
 * Generate prompt text for receipt analysis
 * @param {string} receiptCurrency - the expected currency of the receipt (tripCurrency - where the trip is)
 * @param {string} outputLocale - the user's preferred locale for translations (defaultCurrency - user's home currency)
 * @returns {string} The generated prompt
 */
function generatePrompt(receiptCurrency, outputLocale) {
  const language = languageMap[outputLocale] || 'English'
  const dateFormat = dateFormatMap[receiptCurrency] || 'DD/MM/YYYY (international format)'

  return `
Analyze the provided receipt image and extract the following information:

Details for extraction:
- For 'grandTotal': The final total amount paid.
- For 'paidAtString': Extract the date and time of purchase from the receipt.
  IMPORTANT DATE PARSING INSTRUCTIONS:
  * The receipt is likely from a ${receiptCurrency} currency region, which typically uses ${dateFormat}.
  * Use this knowledge to interpret ambiguous dates correctly (e.g., "05/03/2024" should be interpreted based on regional format).
  * For dates like "13/03/2024", it's clear that 13 is the day (since months only go to 12).
  * For ambiguous dates like "05/03/2024", use the regional format: ${dateFormat}.
  * Always output the final date in YYYY-MM-DD HH:mm format, regardless of the input format.
  * If you cannot extract a valid date, use null.
- For 'currency': Detect the currency from the receipt. The expected currency is "${receiptCurrency}" but use the actual currency shown on the receipt if different.
- For 'items':
    - List each distinct item. If the receipt includes consumer tax or any form of discount from the grand total, also include it in the items.
    - 'name': Primary product name. Exclude quantities (e.g., '5コ', '3マイ'), original prices if discounted, and generic prefixes like "FF " or "Lm" unless part of the product identifier.
    - 'price': Final price paid for that item after any item-specific discounts.
    - 'translatedName': REQUIRED - Translate the item name to ${language}. If the item is already in ${language}, use the same name. Do not leave this field null.
    - 'quantity': Quantity of the item. Default to 1 if not provided.
- For 'description': Generate a brief summary in ${language}. Include the store/location name and the category of items purchased (e.g., "FamilyMart, snacks and drinks" or "Disneyland, entrance tickets" or "Starbucks, coffee"). Do NOT list individual item names as they are already captured in the items field.
- If any numeric or date string field cannot be reliably extracted, use null.

Please analyze the receipt in its native language if possible, but ensure the response follows the schema structure.
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

  return JSON.parse(result.text)
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
  convertToTimestamp,
  prepareFirestoreUpdateData,
  getContentTypeFromPath,
  timezoneMap,
  languageMap,
  dateFormatMap,
  receiptSchema,
  expenseItemSchema,
}
