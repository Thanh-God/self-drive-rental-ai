import apiClient from './client';
import { assistantQuota } from '../utils/assistant';

const INTENTS = ['ANSWER', 'SEARCH_VEHICLES', 'ASK_MISSING', 'OUT_OF_SCOPE'];
const KNOWLEDGE_ID = /^K-[A-H]\d{2}$/;
const count = value => Number.isSafeInteger(value) && value >= 0;
const FIELDS = ['pickupDate', 'returnDate', 'pickupBranchId', 'returnBranchId', 'passengers', 'budgetVndTotal', 'transmission'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Search criteria the client will store and send back: known fields only, each null or of the right shape. */
export function validCriteria(c) {
  if (c === null) return true;
  if (typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k => !FIELDS.includes(k))) return false;
  const nullOr = (v, ok) => v === null || v === undefined || ok(v);
  return nullOr(c.pickupDate, v => typeof v === 'string' && ISO_DATE.test(v))
    && nullOr(c.returnDate, v => typeof v === 'string' && ISO_DATE.test(v))
    && nullOr(c.pickupBranchId, v => typeof v === 'string' && v.length > 0 && v.length <= 36)
    && nullOr(c.returnBranchId, v => typeof v === 'string' && v.length > 0 && v.length <= 36)
    && nullOr(c.passengers, v => Number.isInteger(v) && v >= 2 && v <= 9)
    && nullOr(c.budgetVndTotal, count)
    && nullOr(c.transmission, v => v === 'AUTO' || v === 'MANUAL');
}

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
  if (!Array.isArray(data.missing) || data.missing.some(m => !FIELDS.includes(m))) return false;
  if (!Array.isArray(data.cards) || data.cards.length > 3 || !data.cards.every(validCard)
    || new Set(data.cards.map(card => card.vehicleId)).size !== data.cards.length) return false;
  if (data.cards.length && data.intent !== 'SEARCH_VEHICLES') return false;
  if (!validCriteria(data.criteria)) return false;
  return assistantQuota(data.quota) !== null;
}
