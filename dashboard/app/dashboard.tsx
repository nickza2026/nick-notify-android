'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ackLabel, bangkokDate, count, dateBounds, formatTime, importanceLabel, providerLabel, statuses, type AlertDetail, type AlertSummary, type HistoryResponse, type Importance, type StatsResponse, type StatusFilter } from '@/lib/protocol';

type Filter = { from: string; to: string; status: StatusFilter };
type LoadState = 'loading' | 'ready' | 'error';
const statusNames: Record<StatusFilter, string> = {
  all: 'ทุกสถานะ', provider_accepted: 'ผู้ให้บริการรับคำขอแล้ว', provider_failed: 'ผู้ให้บริการปฏิเสธ',
  delivery_unknown: 'ไม่ทราบผลส่ง', acknowledged: 'มีรายงานแตะรับทราบ', pending_ack: 'รอรายงานแตะรับทราบ',
};

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 401 ? 'ไม่มีสิทธิ์ดูประวัติ' : 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง');
  return response.json() as Promise<T>;
}

function Time({ value }: { value: string | null | undefined }) {
  return <time dateTime={value || undefined}>{formatTime(value)}</time>;
}

function ImportanceBadge({ importance }: { importance: Importance }) {
  return <span className="status-pill importance-pill" data-importance={importance}>{importanceLabel(importance)}</span>;
}

function Summary({ stats, state, error }: { stats: StatsResponse | null; state: LoadState; error: string }) {
  const cards = [
    { title: 'เหตุการณ์ทั้งหมด', number: stats?.total_alerts, note: 'ตามช่วงเวลาที่เลือก' },
    { title: 'ผู้ให้บริการรับคำขอ', number: stats?.provider_accepted, note: 'ไม่ยืนยันว่าอุปกรณ์ได้รับหรือส่งเสียง' },
    { title: 'ส่งไม่สำเร็จ / ไม่ทราบผล', number: `${count(stats?.provider_failed)} / ${count(stats?.delivery_unknown)}`, note: 'แยกจำนวนปฏิเสธและผลที่ไม่ทราบ' },
    { title: 'มีรายงานแตะ / รอรายงาน', number: `${count(stats?.acknowledged)} / ${count(stats?.pending_ack)}`, note: 'เป็นจำนวนเหตุการณ์ ไม่ใช่จำนวนครั้งที่แตะ' },
    { title: 'จำนวนการแตะที่รายงาน', number: stats?.ack_action_count, note: 'นับ client_action_id ไม่ซ้ำข้ามเหตุการณ์' },
  ];
  return <section aria-labelledby="summary-title" className="section">
    <div className="section-heading"><div><h2 id="summary-title">ภาพรวมตามช่วงเวลา</h2><p>ภาพรวมไม่ใช้ตัวกรองสถานะของรายการ</p></div></div>
    {state === 'error' && <p role="alert" className="error">{error}{stats && ' — ตัวเลขเดิมอาจไม่เป็นปัจจุบัน'}</p>}
    <div className="summary-grid">{cards.map((card) => <article className="summary-card" key={card.title}>
      <h3>{card.title}</h3><strong aria-label={state === 'loading' && !stats ? 'กำลังโหลด' : undefined} className={state === 'loading' && !stats ? 'skeleton metric' : 'metric'}>{state === 'loading' && !stats ? '　' : typeof card.number === 'string' ? card.number : count(card.number)}</strong><p>{card.note}</p>
    </article>)}</div>
  </section>;
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    dialog.current?.showModal();
    getJSON<AlertDetail>(`/api/alerts/${encodeURIComponent(id)}`, controller.signal).then(setDetail).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'โหลดรายละเอียดไม่สำเร็จ');
    });
    return () => { controller.abort(); dialog.current?.close(); };
  }, [id]);
  const actions = detail?.ack_actions ?? [];
  const unique = [...new Map(actions.map((action) => [action.client_action_id, action])).values()].sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  return <dialog className="detail-dialog" ref={dialog} onClose={onClose} aria-labelledby="detail-title">
    <div className="detail-header"><div><span className="eyebrow">รายละเอียดเหตุการณ์</span><h2 id="detail-title">{detail?.title ?? 'กำลังโหลดรายละเอียด…'}</h2></div><button type="button" className="icon-button" onClick={() => dialog.current?.close()} aria-label="ปิดรายละเอียด">×</button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {!detail && !error && <p role="status">กำลังโหลดรายละเอียด…</p>}
    {detail && <div className="detail-body">
      <p className="full-message">{detail.message}</p><dl className="detail-fields">
        <div><dt>รหัสเหตุการณ์</dt><dd className="break">{detail.alert_id}</dd></div>
        <div><dt>ระดับการแจ้งเตือน</dt><dd><ImportanceBadge importance={detail.importance} /></dd></div>
        <div><dt>สถานะผู้ให้บริการ</dt><dd>{providerLabel(detail)}</dd></div>
        <div><dt>สถานะการแตะ</dt><dd>{ackLabel(detail)}</dd></div>
        <div><dt>สร้างเมื่อ</dt><dd><Time value={detail.created_at} /></dd></div>
        <div><dt>ผู้ให้บริการรับคำขอเมื่อ</dt><dd><Time value={detail.provider_accepted_at} /></dd></div>
        <div><dt>กำหนดเริ่มแจ้งเตือนล่าสุด — ไม่ใช่เวลาหยุดเสียง</dt><dd><Time value={detail.expires_at} /></dd></div>
        <div><dt>รับทราบครั้งแรก — เวลาเซิร์ฟเวอร์</dt><dd><Time value={detail.acknowledged_at} /></dd></div>
        <div><dt>ครั้งล่าสุดที่เซิร์ฟเวอร์รับการแตะ</dt><dd><Time value={detail.last_ack_at} /></dd></div>
        <div><dt>จำนวนการแตะที่รายงานสำหรับเหตุการณ์นี้</dt><dd>{count(detail.ack_count)}</dd></div>
      </dl>
      {typeof detail.ack_count === 'number' && detail.ack_count !== unique.length && <p role="status" className="notice">จำนวนการแตะไม่ตรงกับรายการการแตะที่ได้รับ ({count(unique.length)} รายการ) — โปรดตรวจสอบข้อมูลต้นทาง</p>}
      <h3>ลำดับการแตะที่รายงาน</h3><p className="muted">เวลาที่เซิร์ฟเวอร์รับเป็นหลัก เวลาอุปกรณ์เป็นข้อมูลประกอบและอาจคลาดเคลื่อน</p>
      {unique.length === 0 ? <p>ไม่มีรายการการแตะที่รายงาน</p> : <ol className="timeline">{unique.map((action) => <li key={action.client_action_id}><strong><Time value={action.received_at} /></strong><span>เวลาอุปกรณ์: <Time value={action.client_acked_at} /></span><small className="break">รหัสการแตะ: {action.client_action_id}</small></li>)}</ol>}
    </div>}
  </dialog>;
}

export default function Dashboard({ demo }: { demo: boolean }) {
  const today = bangkokDate(new Date());
  const [draftFrom, setDraftFrom] = useState(today);
  const [draftTo, setDraftTo] = useState(today);
  const [draftStatus, setDraftStatus] = useState<StatusFilter>('all');
  const [filter, setFilter] = useState<Filter>({ from: today, to: today, status: 'all' });
  const [filterError, setFilterError] = useState('');
  const [items, setItems] = useState<AlertSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<LoadState>('loading');
  const [historyError, setHistoryError] = useState('');
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsState, setStatsState] = useState<LoadState>('loading');
  const [statsError, setStatsError] = useState('');
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => { seq.current++; setGeneration((value) => value + 1); }, []);
  useEffect(() => {
    const sequence = ++seq.current;
    const bounds = dateBounds(filter.from, filter.to);
    if (!bounds) return;
    const query = new URLSearchParams({ ...bounds, status: filter.status, limit: '25' });
    setHistoryState('loading'); setStatsState('loading'); setHistoryError(''); setStatsError('');
    getJSON<HistoryResponse>(`/api/history?${query}`).then((data) => {
      if (sequence !== seq.current) return;
      setItems(data.items); setCursor(data.next_cursor); setHistoryState('ready'); setLastFetched(new Date().toISOString());
    }).catch((cause: unknown) => {
      if (sequence !== seq.current) return;
      setHistoryError(cause instanceof Error ? cause.message : 'โหลดรายการไม่สำเร็จ'); setHistoryState('error');
    });
    getJSON<StatsResponse>(`/api/stats?${new URLSearchParams(bounds)}`).then((data) => {
      if (sequence !== seq.current) return;
      setStats(data); setStatsState('ready');
    }).catch((cause: unknown) => {
      if (sequence !== seq.current) return;
      setStatsError(cause instanceof Error ? cause.message : 'โหลดภาพรวมไม่สำเร็จ'); setStatsState('error');
    });
  }, [filter, generation]);

  async function loadMore() {
    if (!cursor || historyState !== 'ready') return;
    const sequence = seq.current;
    const bounds = dateBounds(filter.from, filter.to);
    if (!bounds) return;
    setHistoryState('loading'); setHistoryError('');
    try {
      const data = await getJSON<HistoryResponse>(`/api/history?${new URLSearchParams({ ...bounds, status: filter.status, limit: '25', cursor })}`);
      if (sequence !== seq.current) return;
      setItems((old) => [...old, ...data.items]); setCursor(data.next_cursor); setHistoryState('ready'); setLastFetched(new Date().toISOString());
    } catch (cause) {
      if (sequence !== seq.current) return;
      setHistoryError(cause instanceof Error ? cause.message : 'โหลดรายการเพิ่มเติมไม่สำเร็จ'); setHistoryState('error');
    }
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dateBounds(draftFrom, draftTo)) { setFilterError('กรุณาเลือกช่วงวันที่ที่ถูกต้อง โดยวันเริ่มต้องไม่เกินวันสิ้นสุด'); return; }
    setFilterError(''); setItems([]); setCursor(null); setStats(null);
    const next = { from: draftFrom, to: draftTo, status: draftStatus };
    setFilter(next); refresh();
  }
  function clearFilters() {
    setDraftFrom(today); setDraftTo(today); setDraftStatus('all'); setFilterError(''); setItems([]); setCursor(null); setStats(null);
    const next: Filter = { from: today, to: today, status: 'all' };
    setFilter(next); refresh();
  }
  function closeDetail() { setSelectedId(null); previousFocus.current?.focus(); }

  return <main className="shell">
    {demo && <div className="demo-banner" role="status">ข้อมูลสาธิต — ไม่ใช่ประวัติการส่งจริง</div>}
    <header className="page-header"><div><span className="eyebrow">ศูนย์ปฏิบัติการ · อ่านอย่างเดียว</span><h1>ประวัติการแจ้งเตือน</h1><p>ตรวจสอบผลการส่งคำขอและการแตะรับทราบที่รายงานจากอุปกรณ์ ข้อมูลการรับคำขอไม่ยืนยันว่าอุปกรณ์ส่งเสียงแล้ว</p></div><div className="refresh-group"><button type="button" onClick={refresh} className="primary-button">รีเฟรชข้อมูล</button><span className="muted" aria-live="polite">{lastFetched ? <>ดึงรายการล่าสุด: <Time value={lastFetched} /> (เวลาบนอุปกรณ์นี้)</> : 'ยังไม่ได้ดึงรายการ'}</span></div></header>
    <section className="filter-panel" aria-label="ตัวกรองรายการ"><form onSubmit={applyFilters}><div className="filter-fields"><label>ตั้งแต่วันที่ <input type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} required /></label><label>ถึงวันที่ <input type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} required /></label><label>สถานะรายการ <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as StatusFilter)}>{statuses.map((status) => <option value={status} key={status}>{statusNames[status]}</option>)}</select></label></div><div className="filter-actions"><button type="submit" className="primary-button">ใช้ตัวกรอง</button><button type="button" className="secondary-button" onClick={clearFilters}>ล้างตัวกรอง</button></div>{filterError && <p role="alert" className="error">{filterError}</p>}</form></section>
    <Summary stats={stats} state={statsState} error={statsError} />
    <section className="section history-section" aria-labelledby="history-title"><div className="section-heading"><div><h2 id="history-title">รายการแจ้งเตือน</h2><p>เรียงจากใหม่ไปเก่า · {statusNames[filter.status]}</p></div><span className="loaded-count" aria-live="polite">{historyState === 'loading' && items.length === 0 ? 'กำลังโหลดรายการ…' : `โหลดแล้ว ${count(items.length)} รายการ`}</span></div>
      {historyState === 'error' && <p role="alert" className="error">{historyError}{items.length > 0 && ' — แสดงรายการเดิมซึ่งอาจไม่เป็นปัจจุบัน'}</p>}
      {historyState === 'loading' && items.length === 0 ?
        <div className="loading-list" role="status" aria-label="กำลังโหลดรายการ"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> :
        items.length === 0 && historyState === 'ready' ?
          <div className="empty"><h3>{filter.status === 'all' ? 'ยังไม่มีประวัติในช่วงเวลานี้' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}</h3><p>ลองปรับช่วงวันที่หรือเลือกสถานะอื่น</p></div> :
          items.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>สร้างเมื่อ</th><th>ข้อความ</th><th>ระดับการแจ้งเตือน</th><th>ผลผู้ให้บริการ</th><th>การแตะรับทราบ</th><th>จำนวนแตะ</th><th>รับทราบครั้งแรก (เซิร์ฟเวอร์)</th><th>รับทราบล่าสุด (เซิร์ฟเวอร์)</th><th>รายละเอียด</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.alert_id}>
              <td data-label="สร้างเมื่อ"><Time value={item.created_at} /></td>
              <td data-label="ข้อความ" className="message-cell"><strong className="clamp">{item.title}</strong><span className="clamp">{item.message}</span></td>
              <td data-label="ระดับการแจ้งเตือน"><ImportanceBadge importance={item.importance} /></td>
              <td data-label="ผลผู้ให้บริการ"><span className="status-pill" data-state={item.status === 'provider_failed' ? 'failed' : item.status === 'provider_accepted' ? 'accepted' : 'unknown'}>{providerLabel(item)}</span></td>
              <td data-label="การแตะรับทราบ"><span className="status-pill" data-state={item.acknowledged_at || (item.ack_count ?? 0) > 0 ? 'acknowledged' : 'pending'}>{ackLabel(item)}</span></td>
              <td data-label="จำนวนแตะ">{count(item.ack_count)}</td>
              <td data-label="รับทราบครั้งแรก">{item.ack_count === 0 ? 'ยังไม่มี' : <Time value={item.acknowledged_at} />}</td>
              <td data-label="รับทราบล่าสุด">{item.ack_count === 0 ? 'ยังไม่มี' : <Time value={item.last_ack_at} />}</td>
              <td data-label="รายละเอียด"><button type="button" className="secondary-button" onClick={(event) => {
                previousFocus.current = event.currentTarget; setSelectedId(item.alert_id);
              }}>ดูรายละเอียด<span className="sr-only"> {item.title}</span></button></td>
            </tr>)}</tbody></table></div>}
      {cursor && items.length > 0 && <div className="load-more"><button type="button" className="secondary-button" onClick={loadMore} disabled={historyState === 'loading'}>{historyState === 'loading' ? 'กำลังโหลด…' : 'โหลดเพิ่มเติม'}</button></div>}
    </section>
    {selectedId && <Detail id={selectedId} onClose={closeDetail} />}
  </main>;
}
