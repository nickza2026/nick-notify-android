'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, DatePicker, Descriptions, Empty, Modal, Select, Skeleton, Statistic, Table, Tag, Timeline } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { clientJSON } from '@/lib/client';
import { beginNextPage, finishNextPage, historyGeneration, historyReady } from '@/lib/history-pagination';
import { ackLabel, bangkokDate, count, dateBounds, formatTime, importanceLabel, providerLabel, statuses, type AlertDetail, type AlertSummary, type HistoryResponse, type Importance, type StatsResponse, type StatusFilter } from '@/lib/protocol';

type Filter = { from: string; to: string; status: StatusFilter };
type LoadState = 'loading' | 'ready' | 'error';
type HistoryLoadState = LoadState | 'page-error';
const statusNames: Record<StatusFilter, string> = {
  all: 'ทุกสถานะ', provider_accepted: 'ผู้ให้บริการรับคำขอแล้ว', provider_failed: 'ผู้ให้บริการปฏิเสธ',
  delivery_unknown: 'ไม่ทราบผลส่ง', acknowledged: 'มีรายงานแตะรับทราบ', pending_ack: 'รอรายงานแตะรับทราบ',
};

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  return clientJSON<T>(url, undefined, undefined, signal);
}

function Time({ value, compact = false }: { value: string | null | undefined; compact?: boolean }) {
  const parsed = value ? new Date(value) : null;
  const label = compact && parsed && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(parsed)
    : formatTime(value);
  return <time dateTime={value || undefined} title={compact ? formatTime(value) : undefined}>{label}</time>;
}

function ImportanceBadge({ importance }: { importance: Importance }) {
  return <Tag color={importance === 'critical' ? 'error' : 'default'}>{importanceLabel(importance)}</Tag>;
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
    {state === 'error' && <Alert type="error" showIcon message={error + (stats ? ' — ตัวเลขเดิมอาจไม่เป็นปัจจุบัน' : '')} />}
    <div className="summary-grid">{cards.map((card) => <article className="summary-card" key={card.title}>
      {state === 'loading' && !stats ? <Skeleton active title paragraph={{ rows: 1 }} /> : <Statistic title={card.title} value={typeof card.number === 'string' ? card.number : count(card.number)} />}
      <p>{card.note}</p>
    </article>)}</div>
  </section>;
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    getJSON<AlertDetail>(`/api/alerts/${encodeURIComponent(id)}`, controller.signal).then(setDetail).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'โหลดรายละเอียดไม่สำเร็จ');
    });
    return () => controller.abort();
  }, [id]);
  const actions = detail?.ack_actions ?? [];
  const unique = [...new Map(actions.map((action) => [action.client_action_id, action])).values()].sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  return <Modal open centered title={<span id="detail-title">{detail?.title ?? 'รายละเอียดเหตุการณ์'}</span>} onCancel={onClose} footer={null} destroyOnHidden width={640} styles={{ container: { maxHeight: 'calc(100dvh - 64px)', display: 'flex', flexDirection: 'column' }, header: { flexShrink: 0 }, body: { minHeight: 0, overflowY: 'auto' } }} aria-labelledby="detail-title" closeIcon={<span aria-label="ปิดรายละเอียด">×</span>}>
    {error && <Alert type="error" showIcon message={error} />}
    {!detail && !error && <div role="status" aria-label="กำลังโหลดรายละเอียด"><Skeleton active /></div>}
    {detail && <div className="detail-body">
      <p className="full-message">{detail.message}</p><Descriptions className="detail-fields" column={1} size="small" bordered items={[
        { key: 'id', label: 'รหัสเหตุการณ์', children: <span className="break">{detail.alert_id}</span> },
        { key: 'importance', label: 'ระดับการแจ้งเตือน', children: <ImportanceBadge importance={detail.importance} /> },
        { key: 'provider', label: 'สถานะผู้ให้บริการ', children: providerLabel(detail) },
        { key: 'ack', label: 'สถานะการแตะ', children: ackLabel(detail) },
        { key: 'created', label: 'สร้างเมื่อ', children: <Time value={detail.created_at} /> },
        { key: 'accepted', label: 'ผู้ให้บริการรับคำขอเมื่อ', children: <Time value={detail.provider_accepted_at} /> },
        { key: 'expires', label: 'กำหนดเริ่มแจ้งเตือนล่าสุด — ไม่ใช่เวลาหยุดเสียง', children: <Time value={detail.expires_at} /> },
        { key: 'first', label: 'รับทราบครั้งแรก — เวลาเซิร์ฟเวอร์', children: <Time value={detail.acknowledged_at} /> },
        { key: 'last', label: 'ครั้งล่าสุดที่เซิร์ฟเวอร์รับการแตะ', children: <Time value={detail.last_ack_at} /> },
        { key: 'count', label: 'จำนวนการแตะที่รายงานสำหรับเหตุการณ์นี้', children: count(detail.ack_count) },
      ]} />
      {typeof detail.ack_count === 'number' && detail.ack_count !== unique.length && <Alert type="warning" showIcon message={`จำนวนการแตะไม่ตรงกับรายการการแตะที่ได้รับ (${count(unique.length)} รายการ) — โปรดตรวจสอบข้อมูลต้นทาง`} />}
      <h3>ลำดับการแตะที่รายงาน</h3><p className="muted">เวลาที่เซิร์ฟเวอร์รับเป็นหลัก เวลาอุปกรณ์เป็นข้อมูลประกอบและอาจคลาดเคลื่อน</p>
      {unique.length === 0 ? <Empty description="ไม่มีรายการการแตะที่รายงาน" /> : <Timeline className="timeline" items={unique.map((action) => ({ children: <><strong><Time value={action.received_at} /></strong><span>เวลาอุปกรณ์: <Time value={action.client_acked_at} /></span><small className="break">รหัสการแตะ: {action.client_action_id}</small></> }))} />}
    </div>}
  </Modal>;
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
  const [historyState, setHistoryState] = useState<HistoryLoadState>('loading');
  const [historyError, setHistoryError] = useState('');
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsState, setStatsState] = useState<LoadState>('loading');
  const [statsError, setStatsError] = useState('');
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  const seq = useRef(0);
  const pagination = useRef(historyGeneration(0));
  const tableWrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Ant Table owns horizontal overflow on .ant-table-content when scroll.x is set.
    const scroller = tableWrap.current?.querySelector<HTMLElement>('.ant-table-content');
    scroller?.setAttribute('tabindex', '0');
    scroller?.setAttribute('role', 'region');
    scroller?.setAttribute('aria-label', 'ตารางประวัติการแจ้งเตือน เลื่อนแนวนอนได้');
  }, [historyState, items]);

  const columns: TableColumnsType<AlertSummary> = [
    { title: 'เวลาสร้าง (UTC+7)', dataIndex: 'created_at', key: 'created_at', width: 170, render: (value: string) => <span className="time-cell"><Time value={value} compact /></span> },
    { title: 'การแจ้งเตือน', key: 'message', width: 330, render: (_, item) => <div className="message-cell"><strong className="clamp">{item.title}</strong><span className="clamp">{item.message}</span><ImportanceBadge importance={item.importance} /></div> },
    { title: 'ผลผู้ให้บริการ', key: 'provider', width: 190, render: (_, item) => <Tag color={item.status === 'provider_failed' ? 'error' : item.status === 'provider_accepted' ? 'success' : 'warning'}>{providerLabel(item)}</Tag> },
    { title: 'การรับทราบ', key: 'ack', width: 175, render: (_, item) => <div className="ack-cell"><Tag color={item.acknowledged_at || (item.ack_count ?? 0) > 0 ? 'success' : 'default'}>{ackLabel(item)}</Tag><small>จำนวนแตะ: {count(item.ack_count)}</small></div> },
    { title: 'รายละเอียด', key: 'detail', width: 125, render: (_, item) => <Button onClick={(event) => {
      previousFocus.current = event.currentTarget; setSelectedId(item.alert_id);
    }}>ดูรายละเอียด<span className="sr-only"> {item.title}</span></Button> },
  ];

  const refresh = useCallback(() => {
    pagination.current = historyGeneration(++seq.current);
    setGeneration((value) => value + 1);
  }, []);
  useEffect(() => {
    const sequence = ++seq.current;
    pagination.current = historyGeneration(sequence);
    const bounds = dateBounds(filter.from, filter.to);
    if (!bounds) return;
    const query = new URLSearchParams({ ...bounds, status: filter.status, limit: '25' });
    setHistoryState('loading'); setStatsState('loading'); setHistoryError(''); setStatsError('');
    getJSON<HistoryResponse>(`/api/history?${query}`).then((data) => {
      if (sequence !== seq.current) return;
      pagination.current = historyReady(sequence, data.next_cursor);
      setItems(data.items); setCursor(data.next_cursor); setHistoryState('ready'); setLastFetched(new Date().toISOString());
    }).catch((cause: unknown) => {
      if (sequence !== seq.current) return;
      pagination.current = { ...historyGeneration(sequence), phase: 'initial-error' };
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
    const sequence = seq.current;
    const bounds = dateBounds(filter.from, filter.to);
    if (!bounds) return;
    const next = beginNextPage(pagination.current, sequence);
    if (!next) return;
    // Synchronous ref transition excludes duplicate clicks before React rerenders.
    pagination.current = next;
    setHistoryState('loading'); setHistoryError('');
    try {
      const data = await getJSON<HistoryResponse>(`/api/history?${new URLSearchParams({ ...bounds, status: filter.status, limit: '25', cursor: next.cursor! })}`);
      if (sequence !== seq.current) return;
      pagination.current = finishNextPage(pagination.current, sequence, data.next_cursor);
      setItems((old) => [...old, ...data.items]); setCursor(data.next_cursor); setHistoryState('ready'); setLastFetched(new Date().toISOString());
    } catch (cause) {
      if (sequence !== seq.current) return;
      pagination.current = finishNextPage(pagination.current, sequence, null, true);
      setHistoryError(cause instanceof Error ? cause.message : 'โหลดรายการเพิ่มเติมไม่สำเร็จ'); setHistoryState('page-error');
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
    {demo && <Alert className="demo-banner" type="warning" showIcon message="ข้อมูลสาธิต — ไม่ใช่ประวัติการส่งจริง" role="status" />}
    <header className="page-header">
      <div><span className="eyebrow">ศูนย์ปฏิบัติการ · อ่านอย่างเดียว</span><h1>ประวัติการแจ้งเตือน</h1><p>ตรวจสอบผลการส่งคำขอและการแตะรับทราบที่รายงานจากอุปกรณ์ ข้อมูลการรับคำขอไม่ยืนยันว่าอุปกรณ์ส่งเสียงแล้ว</p></div>
      <div className="refresh-group"><Button onClick={refresh}>รีเฟรชข้อมูล</Button><span className="muted" aria-live="polite">{lastFetched ? <>ดึงรายการล่าสุด: <Time value={lastFetched} /> (เวลาบนอุปกรณ์นี้)</> : 'ยังไม่ได้ดึงรายการ'}</span></div>
    </header>
    <section className="filter-panel" aria-label="ตัวกรองรายการ"><form onSubmit={applyFilters}><div className="filter-fields"><label>ตั้งแต่วันที่ <DatePicker aria-label="ตั้งแต่วันที่" value={draftFrom ? dayjs(draftFrom) : null} format="DD/MM/YYYY" onChange={(date) => setDraftFrom(date ? date.format('YYYY-MM-DD') : '')} allowClear /></label><label>ถึงวันที่ <DatePicker aria-label="ถึงวันที่" value={draftTo ? dayjs(draftTo) : null} format="DD/MM/YYYY" onChange={(date) => setDraftTo(date ? date.format('YYYY-MM-DD') : '')} allowClear /></label><label>สถานะรายการ <Select aria-label="สถานะรายการ" value={draftStatus} onChange={(value: StatusFilter) => setDraftStatus(value)} options={statuses.map((status) => ({ value: status, label: statusNames[status] }))} /></label></div><div className="filter-actions"><Button htmlType="submit" type="primary">ใช้ตัวกรอง</Button><Button onClick={clearFilters}>ล้างตัวกรอง</Button></div>{filterError && <Alert type="error" showIcon message={filterError} />}</form></section>
    <Summary stats={stats} state={statsState} error={statsError} />
    <section className="section history-section" aria-labelledby="history-title"><div className="section-heading"><div><h2 id="history-title">รายการแจ้งเตือน</h2><p>เรียงจากใหม่ไปเก่า · {statusNames[filter.status]}</p></div><span className="loaded-count" aria-live="polite">{historyState === 'loading' && items.length === 0 ? 'กำลังโหลดรายการ…' : `โหลดแล้ว ${count(items.length)} รายการ`}</span></div>
      {(historyState === 'error' || historyState === 'page-error') && <Alert type="error" showIcon message={historyError + (items.length > 0 ? ' — แสดงรายการเดิมซึ่งอาจไม่เป็นปัจจุบัน' : '')} />}
      <div className="table-wrap" ref={tableWrap}><Table<AlertSummary> rowKey="alert_id" columns={columns} dataSource={items} pagination={false} loading={historyState === 'loading' && items.length === 0} scroll={{ x: 990 }} locale={{ emptyText: <Empty description={historyState === 'error' ? 'โหลดรายการไม่สำเร็จ' : filter.status === 'all' ? 'ยังไม่มีประวัติในช่วงเวลานี้' : 'ไม่พบรายการที่ตรงกับตัวกรอง'} /> }} /></div>
      {cursor && items.length > 0 && <div className="load-more"><Button onClick={loadMore} loading={historyState === 'loading'} disabled={historyState === 'error'}>{historyState === 'page-error' ? 'ลองโหลดเพิ่มเติมอีกครั้ง' : 'โหลดเพิ่มเติม'}</Button></div>}
    </section>
    {selectedId && <Detail id={selectedId} onClose={closeDetail} />}
  </main>;
}
