/** Suggested first questions; each is answered from the approved knowledge or starts a vehicle search. */
export const CHAT_SUGGESTIONS = [
  'Thuê xe cần giấy tờ gì?',
  'Có phải đặt cọc không?',
  'Tìm giúp mình xe cho 4 người',
];

export const CHAT_MAX_MESSAGE = 1000;
export const CHAT_MAX_HISTORY = 20;

/** Earlier turns for the API: newest last, at most 20, user/assistant text only. */
export function chatHistory(messages) {
  return messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim() && m.text.length <= CHAT_MAX_MESSAGE)
    .slice(-CHAT_MAX_HISTORY)
    .map(m => ({ role: m.role, text: m.text }));
}
