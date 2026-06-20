const { GoogleGenAI } = require('@google/genai')
const { logger } = require('firebase-functions/v2')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { zodToJsonSchema } = require('zod-to-json-schema')
const { responseSchema, buildClassifyPrompt, parseClassifyResponse } = require('./classifyExpenseHelpers')

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })

/**
 * Call Gemini to classify a list of expenses. Thinking disabled for cost.
 * @param {Array<{id: string, description: string}>} items
 * @returns {Promise<Array<{id: string, category: string}>>}
 */
async function classifyItems(items) {
  if (items.length === 0)
    return []
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ text: buildClassifyPrompt(items) }],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: zodToJsonSchema(responseSchema),
      thinkingConfig: { thinkingBudget: 0 },
    },
  })
  return parseClassifyResponse(result.text, items)
}

exports.classifyExpense = onCall({ region: 'us-west1' }, async (request) => {
  const items = request.data?.items
  if (!Array.isArray(items))
    throw new HttpsError('invalid-argument', 'items must be an array of { id, description }')

  // Defensive: drop malformed entries, cap list size to bound token cost.
  const clean = items
    .filter(it => it && typeof it.id === 'string' && typeof it.description === 'string' && it.description.trim())
    .slice(0, 100)

  try {
    const results = await classifyItems(clean)
    return { results }
  }
  catch (error) {
    logger.error('classifyExpense failed:', error)
    throw new HttpsError('internal', `Classification failed: ${error.message}`)
  }
})
