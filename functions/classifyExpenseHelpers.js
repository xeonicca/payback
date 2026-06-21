const { logger } = require('firebase-functions/v2')
const { z } = require('zod')
const { CATEGORY_KEYS, categoryEnum, coerceCategory } = require('./categories')

const responseSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    category: categoryEnum,
  })),
})

/**
 * Build the classification prompt for a list of {id, description}.
 * @param {Array<{id: string, description: string}>} items
 * @returns {string}
 */
function buildClassifyPrompt(items) {
  const payload = items.map(it => ({ id: it.id, description: it.description }))
  return `
You are categorising travel expenses. For EACH input expense, choose exactly ONE category from this list (output the lowercase key only):
- food: restaurants, cafés, bars, drinks, snacks, prepared meals
- groceries: supermarkets, convenience stores, raw ingredients
- transport: taxi, train, bus, flights, fuel, parking, transit cards
- lodging: hotels, hostels, guesthouses, Airbnb
- activities: attractions, tours, tickets, museums, entertainment
- shopping: retail goods, clothing, electronics, souvenirs
- other: anything that does not clearly fit the above

Allowed keys: ${CATEGORY_KEYS.join(', ')}.
Descriptions may be in Traditional Chinese, English, or mixed. If unsure, use "other".
Return one result per input id, preserving the id exactly.

Input expenses (JSON):
${JSON.stringify(payload)}
`
}

/**
 * Parse the model response into a complete {id, category} list.
 * Coerces unknown categories to 'other' and fills any missing input id with 'other'.
 * @param {string} text - raw JSON text from the model
 * @param {Array<{id: string, description: string}>} items - original inputs
 * @returns {Array<{id: string, category: string}>}
 */
function parseClassifyResponse(text, items) {
  let byId = {}
  try {
    const parsed = JSON.parse(text)
    for (const r of parsed.results || []) {
      if (r && typeof r.id === 'string')
        byId[r.id] = coerceCategory(r.category)
    }
  }
  catch (err) {
    logger.error('Failed to parse classifyExpense response:', err)
    byId = {}
  }
  return items.map(it => ({ id: it.id, category: byId[it.id] ?? 'other' }))
}

module.exports = { responseSchema, buildClassifyPrompt, parseClassifyResponse }
