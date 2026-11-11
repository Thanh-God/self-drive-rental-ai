import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { DEMO_MODE } from '../../demo/config';
import { useApiData } from '../../hooks/useApiData';
import { sendChat } from '../../api/assistantChat';
import { assistantQuota, assistantQuotaExhausted, assistantSearch } from '../../utils/assistant';
import { money } from '../common/PageKit';
import { CHAT_MAX_MESSAGE, CHAT_SUGGESTIONS, chatHistory } from '../../utils/assistantChat';
import { getErrorMessage } from '../../utils/roles';
import RouteExplorer from './RouteExplorer';

/** Trip parameters for vehicle links, only when the turn's criteria are complete. */
function tripSuffix(criteria) {
  const c = criteria || {};
  return c.pickupDate && c.returnDate && c.pickupBranchId && c.returnBranchId && Number.isSafeInteger(c.budgetVndTotal) ? assistantSearch(c) : '';
}

function cardReasons(card, criteria) {
  const reasons = [];
  if (Number.isInteger(criteria?.passengers)) reasons.push(`Đủ chỗ cho ${criteria.passengers} người`);
  if (card.reasonCodes.includes('WITHIN_TOTAL_BUDGET')) reasons.push('Trong tổng ngân sách');
  if (card.reasonCodes.includes('TRANSMISSION_MATCH')) reasons.push('Khớp hộp số ưu tiên');
  return reasons.join(' · ');
}

/** Up to three vehicles found by the backend for this turn; totals include the route fee. */
function ChatCards({ cards, criteria }) {
  const suffix = tripSuffix(criteria);
  return <div className="assistant-results assistant-chat-cards">
    {cards.map((card, index) => <article key={card.vehicleId}>
      {index === 0 && <span className="assistant-best">Gợi ý đầu tiên</span>}
      <h4>{card.vehicleName}</h4>
      <strong>{money(card.total)}</strong>
      <span className="assistant-total">Tổng tiền thuê và phí tuyến · {card.rentalDays} ngày</span>
      {cardReasons(card, criteria) && <p>{cardReasons(card, criteria)}</p>}
      <Link to={`/vehicles/${encodeURIComponent(card.vehicleId)}${suffix}`}>Xem xe <span aria-hidden="true">↗</span></Link>
    </article>)}
    <Link className="assistant-all" to={`/vehicles${suffix}`}>Tìm thêm xe theo chuyến đi</Link>
  </div>;
}

/**
 * One chat session for the signed-in renter. The conversation and the vehicle-search criteria live only in
 * memory; the parent remounts this component on identity or token change, which drops both.
 */
export default function AssistantChat({ visible }) {
  const [open, setOpen] = useState(false), [messages, setMessages] = useState([]), [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [criteria, setCriteria] = useState(null);
  const [responseQuota, setResponseQuota] = useState(null), [routeRevision, setRouteRevision] = useState(0);
  const [unsent, setUnsent] = useState(null);
  const previousOpen = useRef(false), pending = useRef(null), generation = useRef(0), busyRef = useRef(false);
  const launcher = useRef(null), panel = useRef(null), end = useRef(null), nextId = useRef(1), inFlight = useRef('');
  const title = useId();
  const quotaData = useApiData('/ai/quota', open && visible && !DEMO_MODE);
  // GET /ai/quota is the source of truth once loaded; the quota in a reply only bridges the reload that follows it.
  const freshQuota = quotaData.loading ? null : assistantQuota(quotaData.data);
  const quotaSource = freshQuota ? quotaData.data : responseQuota;
  const quota = freshQuota ?? assistantQuota(responseQuota), exhausted = quota?.remaining === 0;
  const resetAt = quota ? quotaSource.resetAt : null, reloadQuota = quotaData.reload;

  useEffect(() => () => { generation.current++; pending.current?.abort(); }, []);
  useEffect(() => {
    if (open && visible) panel.current?.focus();
    else if (previousOpen.current && visible) launcher.current?.focus();
    previousOpen.current = open;
  }, [open, visible]);
  useEffect(() => { if (open && visible) end.current?.scrollIntoView?.({ block: 'nearest' }); }, [messages, busy, open, visible]);
  // A new allowance starts at resetAt (00:00 Vietnam): read it again then instead of trusting the old count.
  useEffect(() => {
    if (!open || !resetAt) return undefined;
    const wait = new Date(resetAt).getTime() - Date.now();
    if (!(wait > 0)) return undefined;
    const timer = setTimeout(() => { setResponseQuota(null); reloadQuota(); }, Math.min(wait + 1000, 2147483000));
    return () => clearTimeout(timer);
  }, [open, resetAt, reloadQuota]);

  /** Drops a request in flight. When {@code restore} is set, its question goes back to the input box. */
  function cancelPending(restore) {
    if (!busyRef.current) return;
    generation.current++;
    pending.current?.abort();
    busyRef.current = false;
    setBusy(false);
    setMessages(old => old.filter(m => !m.pending));
    if (restore) giveBack(inFlight.current);
  }
  /** A question that was not answered goes back to an empty input box; a newer draft is never overwritten. */
  function giveBack(question) {
    setText(current => current.trim() ? current : question);
    setUnsent(question);
  }
  function close() { cancelPending(true); setOpen(false); }
  function reset() {
    cancelPending(false);
    setMessages([]); setText(''); setError(''); setCriteria(null); setUnsent(null); setRouteRevision(old => old + 1);
  }

  async function send(raw, fromInput = true) {
    const message = raw.trim();
    if (busyRef.current || DEMO_MODE || exhausted || !message || message.length > CHAT_MAX_MESSAGE) return;
    const history = chatHistory(messages);
    const id = nextId.current++;
    setMessages(old => [...old, { id, role: 'user', text: message, pending: true }]);
    if (fromInput) setText('');
    // Sending another question keeps the unsent one on offer; sending that one clears it.
    setError(''); setUnsent(old => old === message ? null : old); inFlight.current = message;
    const run = ++generation.current, controller = new globalThis.AbortController();
    pending.current = controller; busyRef.current = true; setBusy(true);
    try {
      const data = await sendChat({ message, history, criteria }, controller.signal);
      if (generation.current !== run) return;
      // Cards keep the criteria of their own turn, so their links stay right after later turns.
      setMessages(old => [...old.map(m => m.id === id ? { ...m, pending: false } : m),
        { id: nextId.current++, role: 'assistant', text: data.reply, intent: data.intent, citations: data.citations, cards: data.cards, criteria: data.criteria }]);
      if (data.criteria) setCriteria(data.criteria);
      setResponseQuota(data.quota);
      reloadQuota();
    } catch (failure) {
      if (generation.current !== run || controller.signal.aborted) return;
      // The question was not answered: take it out of the conversation and give it back to the input box.
      setMessages(old => old.filter(m => m.id !== id));
      giveBack(message);
      if (failure?.response?.status === 429 && failure.response.data?.code === 'AI_DAILY_LIMIT' && assistantQuota(failure.response.data)) {
        setResponseQuota(failure.response.data);
        reloadQuota();
      }
      else setError(getErrorMessage(failure, failure.message || 'Trợ lý chưa trả lời được. Hãy thử lại.'));
    } finally {
      if (generation.current === run) { busyRef.current = false; setBusy(false); pending.current = null; }
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) { event.preventDefault(); send(text); }
  }

  if (!visible) return null;
  return <div className="kdrive-assistant">
    {open && <section ref={panel} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby={title} className="assistant-panel" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <header className="assistant-heading"><div><span className="assistant-mark"><Sparkles size={18} /></span><div><h2 id={title}>Trợ lý KDrive</h2><p>Hỏi đáp về dịch vụ thuê xe</p></div></div><div>
        <button type="button" aria-label="Bắt đầu lại" title="Bắt đầu lại" onClick={reset}><RotateCcw size={17} /></button>
        <button type="button" aria-label="Thu nhỏ trợ lý" onClick={close}><Minus size={18} /></button>
        <button type="button" aria-label="Đóng trợ lý" onClick={close}><X size={18} /></button>
      </div></header>
      <div className="assistant-body">
        {DEMO_MODE ? <p role="status" className="assistant-welcome">Trợ lý dùng dữ liệu thật ở chế độ API. Bản demo chưa kết nối trò chuyện.</p> : <>
          <div className="assistant-messages" role="log" aria-live="polite" aria-busy={busy} aria-label="Cuộc trò chuyện">
            <p className="assistant-bubble assistant-bubble-bot">Chào bạn, mình là Trợ lý KDrive. Mình trả lời câu hỏi về thuê xe tự lái KDrive và giúp bạn tìm xe theo ngày, chi nhánh, số người và ngân sách.</p>
            {messages.length === 0 && <div className="assistant-suggestions" aria-label="Câu hỏi gợi ý">
              {CHAT_SUGGESTIONS.map(s => <button key={s} type="button" disabled={busy || exhausted} onClick={() => send(s, false)}>{s}</button>)}
            </div>}
            {messages.map(m => m.role === 'user'
              ? <p key={m.id} className="assistant-bubble assistant-bubble-user"><span className="sr-only">Bạn: </span>{m.text}</p>
              : <div key={m.id} className="assistant-turn">
                <p className="assistant-bubble assistant-bubble-bot"><span className="sr-only">Trợ lý: </span>{m.text}</p>
                {m.cards?.length > 0 && <ChatCards cards={m.cards} criteria={m.criteria} />}
                {m.citations?.length > 0 && <p className="assistant-sources">Nguồn: {m.citations.map(c => c.title).join(' · ')}</p>}
                {m.intent === 'ANSWER' && !m.citations?.length && <p className="assistant-sources">Bạn có thể xem xe ở trang <Link to="/vehicles">Tìm xe</Link>.</p>}
              </div>)}
            {busy && <p role="status" className="assistant-typing">Đang trả lời… có thể mất đến một phút.</p>}
            <span ref={end} />
          </div>
          {unsent && unsent !== text.trim() && <div role="status" className="assistant-error assistant-unsent"><p>Câu trước chưa gửi được: “{unsent}”</p>
            <button type="button" disabled={busy || exhausted} onClick={() => send(unsent, false)}>Gửi lại</button></div>}
          {error && <div role="alert" className="assistant-error"><p>{error}</p><p>Bạn có thể gửi lại hoặc dùng trang <Link to="/vehicles">Tìm xe</Link>.</p></div>}
          {quota && (exhausted ? <p role="status" className="assistant-quota assistant-quota-empty">{assistantQuotaExhausted(quota)}</p>
            : <p className="assistant-quota">Còn {quota.remaining}/{quota.limit} lượt hỏi AI hôm nay.{quota.remaining === 1 && ' Đây là lượt cuối; sau đó bạn vẫn tìm xe được ở trang Tìm xe.'}</p>)}
          <form className="assistant-compose" aria-label="Gửi câu hỏi" onSubmit={event => { event.preventDefault(); send(text); }}>
            <textarea aria-label="Câu hỏi cho trợ lý" rows={2} maxLength={CHAT_MAX_MESSAGE} value={text} disabled={exhausted}
              onChange={event => setText(event.target.value)} onKeyDown={onKeyDown}
              placeholder="Ví dụ: Có giao xe tận nhà không?" />
            <button type="submit" aria-label="Gửi" disabled={busy || exhausted || !text.trim()}><Send size={18} /></button>
          </form>
          <p className="assistant-note">Không nhập số điện thoại, email hoặc số giấy tờ. Trợ lý không đặt, hủy hay sửa đơn; giá và lịch được kiểm tra lại khi đặt thuê.</p>
          <p className="assistant-note"><Link to="/vehicles">Tìm xe theo bộ lọc</Link></p>
          <RouteExplorer key={routeRevision} />
        </>}
      </div>
    </section>}
    <button ref={launcher} type="button" className="assistant-launcher" aria-expanded={open} aria-label="Mở Trợ lý KDrive" onClick={() => open ? close() : setOpen(true)}><Sparkles size={20} /><span>Trợ lý KDrive</span></button>
  </div>;
}
