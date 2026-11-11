import apiClient from './client';

const INTENTS = ['ANSWER', 'SEARCH_VEHICLES', 'ASK_MISSING', 'OUT_OF_SCOPE'];

/** One chat turn. The history and search criteria live only in the browser and are sent back each turn. */
export async function sendChat({ message, history = [], criteria = null }, signal) {
  const body = { message };
  if (history.length) body.messages = history;
  if (criteria) body.criteria = criteria;
  const { data } = await apiClient.post('/ai/chat', body, { signal, timeout: 65000 });
  if (!validChatResponse(data)) throw new Error('Phản hồi của trợ lý không hợp lệ. Hãy thử lại.');
  return data;
}

export function validChatResponse(data) {
  if (!data || typeof data !== 'object') return false;
  if (!INTENTS.includes(data.intent) || typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > 2000) return false;
  if (!Array.isArray(data.citations) || data.citations.some(c => !c || typeof c.id !== 'string' || typeof c.title !== 'string')) return false;
  if (!Array.isArray(data.missing) || data.missing.some(m => typeof m !== 'string')) return false;
  if (!Array.isArray(data.cards) || data.cards.length > 3) return false;
  if (data.criteria !== null && (typeof data.criteria !== 'object' || Array.isArray(data.criteria))) return false;
  return Boolean(data.quota) && Number.isInteger(data.quota.remaining);
}
