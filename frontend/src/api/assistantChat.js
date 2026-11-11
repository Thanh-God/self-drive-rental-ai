import apiClient from './client';

const INTENTS = ['ANSWER', 'SEARCH_VEHICLES', 'ASK_MISSING', 'OUT_OF_SCOPE'];
const KNOWLEDGE_ID = /^K-[A-H]\d{2}$/;
const count = value => Number.isSafeInteger(value) && value >= 0;

/** One chat turn. The history and search criteria live only in the browser and are sent back each turn. */
export async function sendChat({ message, history = [], criteria = null }, signal) {
  const body = { message };
  if (history.length) body.messages = history;
  if (criteria) body.criteria = criteria;
  const { data } = await apiClient.post('/ai/chat', body, { signal, timeout: 65000 });
  if (!validChatResponse(data)) throw new Error('Phản hồi của trợ lý không hợp lệ. Hãy thử lại.');
  return data;
}

/** A card must be a coherent backend fact: its total is the rental plus the route fee. */
export function validCard(card) {
  return Boolean(card) && typeof card.vehicleId === 'string' && card.vehicleId.length > 0 && card.vehicleId.length <= 36
    && typeof card.vehicleName === 'string' && card.vehicleName.trim().length > 0
    && Number.isSafeInteger(card.seats) && card.seats > 0 && Number.isSafeInteger(card.rentalDays) && card.rentalDays > 0
    && count(card.rentalTotal) && count(card.oneWayFee) && count(card.total) && card.total === card.rentalTotal + card.oneWayFee
    && Array.isArray(card.reasonCodes) && card.reasonCodes.every(code => typeof code === 'string');
}

export function validChatResponse(data) {
  if (!data || typeof data !== 'object') return false;
  if (!INTENTS.includes(data.intent) || typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > 2000) return false;
  if (!Array.isArray(data.citations) || data.citations.length > 4
    || data.citations.some(c => !c || typeof c.id !== 'string' || !KNOWLEDGE_ID.test(c.id) || typeof c.title !== 'string' || !c.title.trim())) return false;
  if (!Array.isArray(data.missing) || data.missing.some(m => typeof m !== 'string')) return false;
  if (!Array.isArray(data.cards) || data.cards.length > 3 || !data.cards.every(validCard)
    || new Set(data.cards.map(card => card.vehicleId)).size !== data.cards.length) return false;
  if (data.cards.length && data.intent !== 'SEARCH_VEHICLES') return false;
  if (data.criteria !== null && (typeof data.criteria !== 'object' || Array.isArray(data.criteria))) return false;
  return Boolean(data.quota) && Number.isInteger(data.quota.remaining);
}
