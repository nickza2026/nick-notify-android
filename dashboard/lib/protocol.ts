export const statuses = ['all', 'provider_accepted', 'provider_failed', 'delivery_unknown', 'acknowledged', 'pending_ack'] as const;
export type StatusFilter = typeof statuses[number];
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function localDashboardRequest(request: Request): boolean {
  try {
    const url = new URL(request.url);
    const host = request.headers.get('host');
    // Next standalone uses the server bind address in its internal request URL.
    // 0.0.0.0 is metadata only: the actual client Host must still be loopback below.
    if (!host || (!loopbackHosts.has(url.hostname) && url.hostname !== '0.0.0.0')) return false;
    const actual = new URL(`${url.protocol}//${host}`);
    if (actual.username || actual.password || actual.pathname !== '/' || actual.search || actual.hash || !loopbackHosts.has(actual.hostname) || actual.port !== url.port) return false;
    const origin = request.headers.get('origin');
    return origin === null || origin === actual.origin;
  } catch { return false; }
}
export type AlertStatus = string;
export type Importance = 'normal' | 'critical';

export function importanceLabel(importance: Importance): string {
  return importance === 'normal' ? 'ธรรมดา · เงียบ' : 'วิกฤต · ปลุก';
}

export interface AlertSummary {
  alert_id: string;
  title: string;
  message: string;
  status: AlertStatus;
  importance: Importance;
  created_at: string;
  provider_accepted_at: string | null;
  expires_at: string | null;
  acknowledged_at: string | null;
  ack_count: number | null;
  last_ack_at: string | null;
}

export interface AckAction {
  client_action_id: string;
  client_acked_at: string | null;
  received_at: string;
}

export interface AlertDetail extends AlertSummary { ack_actions: AckAction[] }
export interface HistoryResponse { items: AlertSummary[]; next_cursor: string | null }
export interface StatsResponse {
  total_alerts: number | null;
  provider_accepted: number | null;
  provider_failed: number | null;
  delivery_unknown: number | null;
  acknowledged: number | null;
  pending_ack: number | null;
  ack_action_count: number | null;
}

const utc = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/;
export function validUtc(value: string): boolean {
  if (!utc.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

export function historyQuery(params: URLSearchParams): URLSearchParams | null {
  const keys = ['from', 'to', 'status', 'limit', 'cursor'];
  if ([...params.keys()].some((key) => !keys.includes(key) || params.getAll(key).length !== 1)) return null;
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to || !validUtc(from) || !validUtc(to) || Date.parse(from) >= Date.parse(to)) return null;
  const status = params.get('status') ?? 'all';
  const limit = params.get('limit') ?? '25';
  const cursor = params.get('cursor');
  if (!statuses.includes(status as StatusFilter) || !/^(?:[1-9]|1\d|2[0-5])$/.test(limit)) return null;
  if (cursor !== null && (!cursor || cursor.length > 2048 || /[\u0000-\u001f\u007f]/.test(cursor))) return null;
  return new URLSearchParams({ from, to, status, limit, ...(cursor === null ? {} : { cursor }) });
}

export function statsQuery(params: URLSearchParams): URLSearchParams | null {
  if ([...params.keys()].some((key) => !['from', 'to'].includes(key) || params.getAll(key).length !== 1)) return null;
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to || !validUtc(from) || !validUtc(to) || Date.parse(from) >= Date.parse(to)) return null;
  return new URLSearchParams({ from, to });
}

export function dateBounds(from: string, to: string): { from: string; to: string } | null {
  const parse = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value : null;
  };
  const start = parse(from);
  const end = parse(to);
  if (!start || !end || start > end) return null;
  return {
    from: new Date(start.getTime() - 7 * 3600000).toISOString(),
    to: new Date(end.getTime() + 17 * 3600000).toISOString(),
  };
}

export function bangkokDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function formatTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'ไม่ทราบเวลา';
  return `${new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value))} น. (UTC+7)`;
}

export function count(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('th-TH') : 'ไม่ทราบ';
}

export function providerLabel(item: AlertSummary): string {
  if (item.status === 'provider_failed') return 'ผู้ให้บริการปฏิเสธ';
  if (item.status === 'delivery_unknown') return 'ไม่ทราบผลส่ง';
  if (item.provider_accepted_at || item.status === 'provider_accepted') return 'ผู้ให้บริการรับคำขอแล้ว';
  return 'ไม่ทราบสถานะผู้ให้บริการ';
}

export function ackLabel(item: AlertSummary): string {
  if (item.acknowledged_at || item.status === 'acknowledged') return 'มีการรายงานแตะรับทราบ';
  if (typeof item.ack_count === 'number' && item.ack_count > 0) return 'มีรายงานรับทราบ แต่ไม่ทราบเวลา';
  if (item.ack_count === 0) return 'ยังไม่ยืนยันรับทราบ';
  if (item.status === 'pending_ack') return 'รอรายงานการแตะรับทราบ';
  return 'ไม่ทราบสถานะการแตะ';
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_response');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 10000): string {
  if (typeof value !== 'string' || value.length > max) throw Error('invalid_response');
  return value;
}
function timestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = text(value, 64);
  if (!validUtc(result)) throw Error('invalid_response');
  return result;
}
function metric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw Error('invalid_response');
  return value;
}
export function parseSummary(value: unknown): AlertSummary {
  const item = record(value);
  const id = text(item.alert_id, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw Error('invalid_response');
  const created = timestamp(item.created_at);
  if (!created) throw Error('invalid_response');
  // Older Go responses omitted importance and were always critical. An explicitly
  // supplied invalid value must not be silently presented as an alarm.
  const importance = Object.prototype.hasOwnProperty.call(item, 'importance') ? item.importance : 'critical';
  if (importance !== 'normal' && importance !== 'critical') throw Error('invalid_response');
  return { alert_id: id, title: text(item.title), message: text(item.message),
    status: text(item.status, 80), importance, created_at: created, provider_accepted_at: timestamp(item.provider_accepted_at),
    expires_at: timestamp(item.expires_at), acknowledged_at: timestamp(item.acknowledged_at),
    ack_count: metric(item.ack_count), last_ack_at: timestamp(item.last_ack_at) };
}
export function parseHistory(value: unknown): HistoryResponse {
  const data = record(value);
  if (!Array.isArray(data.items) || data.items.length > 100) throw Error('invalid_response');
  const cursor = data.next_cursor == null ? null : text(data.next_cursor, 2048);
  return { items: data.items.map(parseSummary), next_cursor: cursor };
}
export function parseStats(value: unknown): StatsResponse {
  const data = record(value);
  return { total_alerts: metric(data.total_alerts), provider_accepted: metric(data.provider_accepted),
    provider_failed: metric(data.provider_failed), delivery_unknown: metric(data.delivery_unknown),
    acknowledged: metric(data.acknowledged), pending_ack: metric(data.pending_ack), ack_action_count: metric(data.ack_action_count) };
}
export function parseDetail(value: unknown, requestedId: string): AlertDetail {
  const data = record(value);
  const summary = parseSummary(data);
  if (summary.alert_id !== requestedId || !Array.isArray(data.ack_actions) || data.ack_actions.length > 4000) throw Error('invalid_response');
  return { ...summary, ack_actions: data.ack_actions.map((value) => {
    const action = record(value);
    const id = text(action.client_action_id, 36);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw Error('invalid_response');
    const received = timestamp(action.received_at);
    if (!received) throw Error('invalid_response');
    return { client_action_id: id, client_acked_at: timestamp(action.client_acked_at), received_at: received };
  }) };
}
