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
const { categoryEnum, coerceCategory } = require('./categories')
const { reconcileReceipt } = require('./reconcile')

// Extend dayjs with timezone support
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const storage = new Storage()

const SUPPORTED_CURRENCIES = [
  'JPY',
  'USD',
  'EUR',
  'GBP',
  'AUD',
  'CAD',
  'CNY',
  'KRW',
  'SGD',
  'HKD',
  'TWD',
  'VND',
  'MYR',
  'THB',
  'IDR',
  'PHP',
  'NZD',
  'INR',
]

const expenseItemSchema = z.object({
  name: z.string().describe(
    'The clean human product name only. If the receipt name wraps across two physical lines (e.g. a Japanese name continuing on a second indented line before the price), concatenate both lines with a single space into one name. Do NOT include any line/serial number, product code, SKU, or barcode that appears alongside the name — those go in itemNumber.',
  ),
  itemNumber: z.string().nullable().describe(
    'Any receipt-printed identifier next to the item: line/serial number (e.g. "1", "001"), product code (e.g. "A201"), SKU, or JAN/EAN/UPC barcode (e.g. "4524541000672"). Strip leading punctuation like "#" or trailing "." Return null if no identifier is printed for this item.',
  ),
  translatedName: z.string().nullable().describe(
    'The name translated into the target output language ONLY. NEVER use a barcode, JAN/EAN/UPC code, SKU, or numeric product ID as a translation — those belong in itemNumber. If you cannot meaningfully translate (e.g. a proprietary or untranslatable product name), repeat the original name exactly. Do NOT include the original name alongside the translation.',
  ),
  quantity: z.number().nullable().describe('Count of items on this line. Default to 1 if not specified.'),
  price: z.number().describe(
    'The price per SINGLE unit. CAUTION: if the receipt shows "2 @ 10.00 = 20.00", the price is 10.00, NOT 20.00. Do not include currency symbols.',
  ),
  lineTotal: z.number().nullable().describe(
    'The line-total amount printed on the receipt for this item (the rightmost amount on the line). Should equal price * quantity. If only one amount is printed and quantity is 1, lineTotal equals price.',
  ),
})

const receiptSchema = z.object({
  grandTotal: z.number().nullable().describe('The final total amount paid including tax. Null if not printed.'),
  subtotal: z.number().nullable().describe('Pre-tax/service amount printed on the receipt (e.g. 小計, Subtotal). Null if not printed.'),
  taxAmount: z.number().nullable().describe('Sum of all tax lines on the receipt (内税, 外税, 消費税, VAT, GST, Tax). Null if not printed. Stored as a positive number.'),
  serviceCharge: z.number().nullable().describe('Service-charge line if printed (e.g. Phí dịch vụ, Service Charge, 服務費). Null if not printed.'),
  discount: z.number().nullable().describe('Total of discounts / vouchers / promotions deducted from the bill, as a POSITIVE number. Null if no discount.'),
  tip: z.number().nullable().describe('Gratuity / tip if printed. Null if not printed.'),
  printedItemCount: z.number().nullable().describe('The total-item-count printed on the receipt (e.g. 点数, 合計点数, Qty Total, Items: N). This is the receipt\'s own count — do not invent it from items.length. Null if not printed.'),
  paidAtString: z.string().nullable().describe('Date and time of purchase in YYYY-MM-DD HH:mm format. Null if not present.'),
  currency: z.enum(SUPPORTED_CURRENCIES).describe(
    'Currency code detected FROM the receipt itself (symbols ¥/$/€/Rp/₫, codes near totals, formatting). The Receipt Region Hint provided in the prompt is what we expect but NOT authoritative — override it if the receipt clearly shows a different currency. Pick the closest of the supported codes.',
  ),
  items: z.array(expenseItemSchema).describe('Real purchased items only. Do NOT include subtotals, tax lines, service charges, tips, discounts, vouchers, change due, loyalty points, free promotional items printed at 0, or store header/footer messages.'),
  description: z.string().nullable().describe('Concise 1-sentence summary in the TARGET output language only. Do not list every item. Do not provide bilingual output.'),
  category: categoryEnum.describe('The single best-fitting spending category for the whole receipt. food = restaurants/cafes/drinks/snacks; groceries = supermarkets/convenience stores; transport = taxi/train/flight/fuel/transit; lodging = hotels/lodging; activities = attractions/tours/tickets/entertainment; shopping = retail/clothing/souvenirs; other = anything that does not fit. Default to "other" if unsure.'),
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
- Receipt Region Hint: ${receiptCurrency} (informational only — NOT authoritative)
- Expected Date Format: ${dateFormat}
- Target Output Language: ${language}

### RULES

1. **MULTI-LINE ITEM NAMES**
   Receipt items often span two physical lines: the product name on line 1, then a continuation (size, weight, pack count, flavor) on line 2 followed by the price. Treat both lines as ONE item; concatenate them with a single space into 'name'. The 'price', 'quantity', and 'lineTotal' come from the LAST line of the group.
   Example: \`青のり入川えびせ\\n  んべい  2  1100  2200\` → name '青のり入川えびせんべい', qty 2, price 1100, lineTotal 2200.

2. **ITEM IDENTIFIERS → 'itemNumber'**
   If the receipt prints any identifier next to an item — line/serial number ('1.', '001'), product code, SKU, or full barcode (JAN/EAN/UPC, e.g. '4524541000672') — extract it into 'itemNumber' and EXCLUDE it from 'name'. 'name' should contain only the human product name. If no identifier is printed, 'itemNumber' is null.
   Examples:
   - '1. ペプシコーラ' → itemNumber '1', name 'ペプシコーラ'
   - '#A201 Pasta' → itemNumber 'A201', name 'Pasta'
   - '4524541000672 青のり入川えびせんべい' → itemNumber '4524541000672', name '青のり入川えびせんべい'

3. **PRICING LOGIC — UNIT PRICE vs LINE TOTAL**
   - 'price' is the UNIT price (price for ONE item).
   - 'lineTotal' is the line-total amount printed (rightmost amount on the line).
   - Check: price * quantity should equal lineTotal.
   - If qty 1 and only one amount is printed, lineTotal === price.

4. **NON-ITEM LINES — DO NOT PUT IN items[]**
   Do NOT include in items[]: subtotal/小計, tax/税/VAT/GST/消費税, service charge/Phí dịch vụ/服務費, tip/gratuity, discount/voucher/promotion, change due, points/loyalty, store header/footer messages, free promotional items printed at 0. Tax → 'taxAmount'. Service → 'serviceCharge'. Discount/voucher → 'discount' (positive number). Tip → 'tip'. Subtotal → 'subtotal'. Everything else: omit.

5. **printedItemCount**
   If the receipt prints a total item count line (点数, 合計点数, Qty Total, Items: N), extract it as printedItemCount. Otherwise null. Do NOT invent this from items.length.

6. **CURRENCY — DETECT FROM RECEIPT**
   Determine 'currency' from the receipt itself (symbols ¥/$/€/Rp/₫, codes near totals, locale formatting). The Receipt Region Hint above is what we expect but NOT authoritative — override it if the receipt clearly shows a different currency.

7. **TRANSLATION**
   For 'description' and 'translatedName', return text strictly in ${language}. NEVER use a barcode, JAN/EAN/UPC, SKU, or numeric product ID as a translation — those go in itemNumber. If you cannot produce a meaningful translation, repeat the original name exactly. Do not output bilingual "Original (Translation)" pairs.

8. **DATES**
   Parse ambiguous dates (e.g. 05/04/2024) using the regional format: ${dateFormat}. Output in YYYY-MM-DD HH:mm. Null if invalid or absent.

9. **DESCRIPTION**
   One short sentence in ${language} summarizing the receipt (e.g. "7-Eleven, snacks and drinks"). Do not list every item.

10. **CATEGORY**
   Choose exactly ONE category for the whole receipt from: food, groceries, transport, lodging, activities, shopping, other.
   - food: restaurants, cafés, bars, drinks, snacks, prepared meals
   - groceries: supermarkets, convenience stores, raw ingredients
   - transport: taxi, train, bus, flights, fuel, parking, transit cards
   - lodging: hotels, hostels, guesthouses, Airbnb
   - activities: attractions, tours, tickets, museums, entertainment
   - shopping: retail goods, clothing, electronics, souvenirs
   - other: anything that does not clearly fit the above
   If you are unsure, use "other". Output the lowercase key only.

### EXAMPLE (illustrative — adapt to the actual receipt)

Imagine a Japanese supermarket receipt printing:
\`\`\`
お会計レシート
1. ペプシコーラ        150
2. 青のり入川えびせ
     んべい      2   1100   2200
小計         2350
消費税(10%)   235
合計         2585
点数: 3
\`\`\`

Expected JSON:
\`\`\`
{
  "grandTotal": 2585,
  "subtotal": 2350,
  "taxAmount": 235,
  "serviceCharge": null,
  "discount": null,
  "tip": null,
  "printedItemCount": 3,
  "paidAtString": null,
  "currency": "JPY",
  "category": "groceries",
  "items": [
    { "itemNumber": "1", "name": "ペプシコーラ", "translatedName": "...", "quantity": 1, "price": 150, "lineTotal": 150 },
    { "itemNumber": "2", "name": "青のり入川えびせんべい", "translatedName": "...", "quantity": 2, "price": 1100, "lineTotal": 2200 }
  ],
  "description": "..."
}
\`\`\`

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
 * Analyze receipt image using Gemini AI
 * @param {string} imageBase64 - Base64 encoded image data
 * @param {string} contentType - Image MIME type
 * @param {string} tripCurrency - The trip destination currency
 * @param {string} defaultCurrency - The user's default currency
 * @returns {Promise<{grandTotal: number|null, subtotal: number|null, taxAmount: number|null, serviceCharge: number|null, discount: number|null, tip: number|null, printedItemCount: number|null, paidAtString: string|null, currency: string, items: Array, description: string|null, needsReview: boolean, reviewReasons: string[]}>} Reconciled receipt data with needsReview flag and reviewReasons array
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
    model: 'gemini-2.5-flash',
    contents: [
      { text: generatePrompt(tripCurrency, defaultCurrency) },
      imagePart,
    ],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: zodToJsonSchema(receiptSchema),
      thinkingConfig: { thinkingBudget: -1 },
    },
  })

  const parsedData = JSON.parse(result.text)

  // Run server-side reconciliation: math checks, auto-correct unit-price slot,
  // accumulate reviewReasons + needsReview.
  return reconcileReceipt(parsedData, tripCurrency)
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

  // Strip transient fields that should not be written verbatim.
  // - paidAtString: replaced by paidAt Timestamp below
  // - currency: AI-detected currency used by reconcileReceipt for the
  //   currency_unexpected check; we don't persist it (expenses live in
  //   tripCurrency; mismatches are surfaced via reviewReasons instead).
  const { paidAtString, currency: _detectedCurrency, ...restOfData } = parsedDataFromAI

  const firestoreUpdateData = {
    ...restOfData,
    isProcessing: false,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingError: null,
  }

  // needsReview + reviewReasons are produced by reconcileReceipt and travel
  // through restOfData unchanged. Guarantee they're present even on empty paths.
  if (firestoreUpdateData.needsReview == null)
    firestoreUpdateData.needsReview = false
  if (!Array.isArray(firestoreUpdateData.reviewReasons))
    firestoreUpdateData.reviewReasons = []

  // Category: coerce AI output to a known key; default to 'other'.
  firestoreUpdateData.category = coerceCategory(parsedDataFromAI.category)

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
  SUPPORTED_CURRENCIES,
}
