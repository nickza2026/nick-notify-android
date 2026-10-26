import http from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { IdempotencyStore, AckStore } from './store.mjs';
import { SendFailure } from './fcm.mjs';
import { resolve } from 'node:path';

const BODY_LIMIT = 16_384;
const PAYLOAD_LIMIT = 4000; // Conservative budget below FCM's 4096-byte limit.
const hash = value => createHash('sha256').update(value).digest('hex');
class ApiError extends Error {
  constructor(statusCode, code) { super(code); this.statusCode = statusCode; this.code = code; }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let length = 0;
    let settled = false;
    const chunks = [];
    const finishError = error => { if (!settled) { settled = true; reject(error); } };
    request.on('data', chunk => {
      length += chunk.length;
      if (length > BODY_LIMIT) { finishError(new ApiError(413, 'body_too_large')); chunks.length = 0; }
      else if (!settled) chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'invalid_json')); }
    });
    request.on('error', () => finishError(new ApiError(400, 'request_interrupted')));
    request.on('aborted', () => finishError(new ApiError(400, 'request_interrupted')));
  });
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid_schema');
  const allowed = new Set(['alert_id', 'title', 'message', 'ttl_seconds', 'importance']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new ApiError(400, 'unknown_field');
  if (typeof input.title !== 'string' || !input.title.trim() || [...input.title].length > 120 ||
      typeof input.message !== 'string' || !input.message.trim() || [...input.message].length > 2000) {
    throw new ApiError(422, 'invalid_message');
  }
  if (input.alert_id !== undefined && (typeof input.alert_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.alert_id))) {
    throw new ApiError(422, 'invalid_alert_id');
  }
  const ttl = input.ttl_seconds === undefined ? 300 : input.ttl_seconds;
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > 10_800) throw new ApiError(422, 'invalid_ttl');
  const importance = input.importance === undefined ? 'critical' : input.importance;
  if (importance !== 'critical' && importance !== 'normal') throw new ApiError(422, 'invalid_importance');
  // Critical's normalized hash must remain identical to the pre-importance schema.
  return { title: input.title, message: input.message, ttl_seconds: ttl,
    ...(input.alert_id ? { alert_id: input.alert_id } : {}), ...(importance === 'normal' ? { importance } : {}) };
}

function storedImportance(entry) {
  return entry.importance ?? 'critical';
}
function canonicalReceipt(entry) {
  return { ...entry.response, importance: storedImportance(entry) };
}

function validateAckBase(value) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 1024 || /[\s\\\x00-\x1f]/.test(value)) throw new Error('invalid_ack_base_url');
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid_ack_base_url'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.search || url.hash || value.includes('?') || value.includes('#') ||
      !/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*\/?)?$/.test(url.pathname)) throw new Error('invalid_ack_base_url');
  return url.href.replace(/\/$/, '');
}

function validateAckBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['client_acked_at', 'client_action_id'].includes(key))) throw new ApiError(400, 'invalid_schema');
  if (input.client_action_id !== undefined && (typeof input.client_action_id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.client_action_id))) {
    throw new ApiError(422, 'invalid_client_action_id');
  }
  if (input.client_acked_at !== undefined &&
      (typeof input.client_acked_at !== 'string' ||
       !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(input.client_acked_at) ||
       !Number.isFinite(Date.parse(input.client_acked_at)) ||
       new Date(Date.parse(input.client_acked_at)).toISOString().slice(0, 19) !== input.client_acked_at.slice(0, 19))) {
    throw new ApiError(422, 'invalid_client_acked_at');
  }
  return { clientAckedAt: input.client_acked_at, clientActionId: input.client_action_id };
}

export async function createBridge({ apiKey, sender, statePath, ackBaseUrl, ackStatePath = `${statePath}.acks.json`, maxConcurrent = 4, requestsPerMinute = 60, unauthenticatedRequestsPerMinute = 60, now = Date.now }) {
  if (typeof apiKey !== 'string' || Buffer.byteLength(apiKey) < 32) throw new Error('api_key_requires_32_bytes');
  const ackBase = validateAckBase(ackBaseUrl);
  const comparablePath = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  if (ackBase && comparablePath(ackStatePath) === comparablePath(statePath)) throw new Error('ack_state_path_conflict');
  const secretHash = Buffer.from(hash(apiKey), 'hex');
  const store = new IdempotencyStore(statePath);
  await store.init();
  if (!ackBase && [...store.entries.values()].some(entry => entry.ackEnabled)) throw new Error('ack_configuration_missing');
  const ackStore = ackBase ? new AckStore(ackStatePath) : undefined;
  if (ackStore) await ackStore.init();
  if (ackStore && [...store.entries.values()].some(entry => entry.ackEnabled && !ackStore.get(entry.alertId))) {
    throw new Error('ack_store_unavailable');
  }
  if (ackStore) {
    for (const entry of store.entries.values()) {
      if (!entry.ackEnabled) continue;
      const ledger = ackStore.get(entry.alertId);
      if (ledger.importance === undefined && storedImportance(entry) === 'normal') {
        // Upgrade pre-mode ACK ledgers while the authoritative idempotency record
        // still exists; persist before serving, so pruning cannot erase normal.
        await ackStore.setImportance(entry.alertId, 'normal');
      } else if (ledger.importance !== undefined && ledger.importance !== storedImportance(entry)) {
        throw new Error('ack_store_unavailable');
      }
    }
  }
  let active = 0;
  let windowStart = now();
  let count = 0;
  let unauthenticatedCount = 0;
  const reply = (response, code, body, headers = {}) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(code, {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', ...headers,
    });
    response.end(JSON.stringify(body));
  };
  const server = http.createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    const requestId = randomUUID();
    const errorBody = code => ({ error: { code }, request_id: requestId });
    if (request.url === '/health' && request.method === 'GET') {
      reply(response, 200, { ready: typeof sender === 'function', status: 'configuration_only', delivery_verified: false, ack_sync_supported: !!ackStore });
      return;
    }
    const match = /^\/v1\/alerts\/([A-Za-z0-9_-]{1,100})(\/ack)?$/.exec(request.url ?? '');
    const isAck = !!ackStore && request.method === 'POST' && !!match?.[2];
    const authorization = request.headers.authorization;
    const authorized = !isAck && typeof authorization === 'string' && authorization.startsWith('Bearer ') &&
      timingSafeEqual(Buffer.from(hash(authorization.slice(7)), 'hex'), secretHash);
    const token = isAck && typeof authorization === 'string' && /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)
      ? authorization.slice(7) : undefined;
    const tokenHash = token ? hash(token) : undefined;
    const capabilityAuthorized = isAck && ackStore.authorized(match[1], tokenHash);
    if (now() - windowStart >= 60_000) { windowStart = now(); count = 0; unauthenticatedCount = 0; }
    if (!authorized && !capabilityAuthorized) {
      const limited = ++unauthenticatedCount > unauthenticatedRequestsPerMinute;
      request.resume();
      reply(response, limited ? 429 : 401, errorBody(limited ? 'rate_limited' : 'unauthorized'),
        { connection: 'close', ...(limited ? { 'retry-after': '60' } : {}) });
      return;
    }
    const isRead = request.method === 'GET' && !!match && !match[2];
    if (!isAck && !isRead && (request.url !== '/v1/alerts' || request.method !== 'POST')) {
      request.resume(); reply(response, 404, errorBody('not_found')); return;
    }
    if (++count > requestsPerMinute || active >= maxConcurrent) {
      request.resume(); reply(response, 429, errorBody('rate_limited'), { 'retry-after': '60' }); return;
    }
    active++;
    try {
      if (isAck) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new ApiError(415, 'json_required');
        if (Number(request.headers['content-length']) > BODY_LIMIT) throw new ApiError(413, 'body_too_large');
        const { clientAckedAt, clientActionId } = validateAckBody(await readBody(request));
        let result;
        try { result = await ackStore.acknowledge(match[1], tokenHash, clientAckedAt, now, clientActionId); }
        catch { throw new ApiError(503, 'ack_state_unavailable'); }
        if (!result) throw new ApiError(401, 'unauthorized');
        reply(response, 200, result);
        return;
      }
      if (isRead) {
        const id = match[1];
        const entry = store.findAlert(id);
        const ack = await ackStore?.receipt(id);
        if (!entry && !ack) throw new ApiError(404, 'not_found');
        const receipt = entry?.phase === 'complete' ? entry.response : undefined;
        reply(response, 200, { alert_id: id, status: receipt?.status ?? 'delivery_unknown_or_in_progress',
          importance: storedImportance(ack ?? entry),
          acknowledged: !!ack?.acknowledgedAt, delivery_verified: false,
          ...(receipt?.expires_at ? { expires_at: receipt.expires_at } : {}),
          ...(ack?.acknowledgedAt ? { acknowledged_at: ack.acknowledgedAt } : {}),
          ...(ack?.clientAckedAt ? { client_acked_at: ack.clientAckedAt } : {}) });
        return;
      }
      if (typeof sender !== 'function') throw new ApiError(503, 'fcm_not_configured');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new ApiError(415, 'json_required');
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) throw new ApiError(400, 'idempotency_key_required');
      if (Number(request.headers['content-length']) > BODY_LIMIT) throw new ApiError(413, 'body_too_large');
      const input = validate(await readBody(request));
      const bodyHash = hash(JSON.stringify(input));
      const importance = input.importance ?? 'critical';
      const keyHash = hash(key);
      // Check the durable receipt before generating new timestamps, capabilities or applying
      // the changed FCM budget. Never replace or resend an old canonical replay.
      const existing = await store.lookup(keyHash, now());
      if (existing) {
        if (existing.hash !== bodyHash || storedImportance(existing) !== importance) throw new ApiError(409, 'idempotency_conflict');
        if (existing.phase !== 'complete') throw new ApiError(409, 'delivery_unknown_or_in_progress');
        reply(response, existing.statusCode, canonicalReceipt(existing), { 'idempotency-replayed': 'true' });
        return;
      }
      const alertId = input.alert_id ?? `alt_${randomUUID()}`;
      const createdAt = now();
      const expiresAt = new Date(createdAt + input.ttl_seconds * 1000).toISOString();
      // Older APKs ignore importance but treat type=alert as a critical alarm.
      // Unrecognized notice fails closed until the Android client is upgraded.
      const data = { type: importance === 'normal' ? 'notice' : 'alert', alert_id: alertId, title: input.title, message: input.message, expires_at: expiresAt, importance };
      const token = ackStore ? randomBytes(32).toString('base64url') : undefined;
      if (token) {
        data.ack_token = token;
        data.ack_url = `${ackBase}/v1/alerts/${alertId}/ack`;
      }
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > PAYLOAD_LIMIT) throw new ApiError(422, 'payload_too_large');
      let reservation;
      try { reservation = await store.reserve(keyHash, bodyHash, { createdAt, alertId, expiresAt, ackEnabled: false, importance }); }
      catch { throw new ApiError(503, 'idempotency_store_unavailable'); }
      if (reservation.existing) {
        const old = reservation.existing;
        if (old.hash !== bodyHash || storedImportance(old) !== importance) throw new ApiError(409, 'idempotency_conflict');
        if (old.phase !== 'complete') throw new ApiError(409, 'delivery_unknown_or_in_progress');
        reply(response, old.statusCode, canonicalReceipt(old), { 'idempotency-replayed': 'true' });
        return;
      }
      if (reservation.alertIdConflict) throw new ApiError(409, 'alert_id_conflict');
      if (ackStore) {
        let reserved;
        try { reserved = await ackStore.reserve(alertId, hash(token), importance); }
        catch { throw new ApiError(503, 'ack_state_unavailable'); }
        if (!reserved) throw new ApiError(409, 'alert_id_conflict');
        // Only mark this request as dependent on its ledger after that ledger is durable.
        // A failed reservation must not permanently prevent an otherwise healthy restart.
        try { await store.markAckReady(hash(key)); }
        catch { throw new ApiError(503, 'ack_state_unavailable'); }
      }
      let code;
      let result;
      try {
        const remainingSeconds = Math.floor((createdAt + input.ttl_seconds * 1000 - now()) / 1000);
        if (remainingSeconds <= 0) throw new SendFailure('expired_before_send');
        await sender({ data, ttlSeconds: remainingSeconds });
        code = 202;
        result = { alert_id: alertId, status: 'provider_accepted', expires_at: expiresAt, acknowledged: false, delivery_verified: false, importance };
      } catch (error) {
        const known = error instanceof SendFailure;
        code = 502;
        result = {
          alert_id: alertId,
          error: { code: known ? error.code : 'provider_delivery_unknown' },
          status: known && !error.ambiguous ? 'provider_failed' : 'delivery_unknown',
          delivery_verified: false,
          importance,
        };
      }
      try { await store.complete(hash(key), code, result); }
      catch { throw new ApiError(503, 'delivery_state_unavailable'); }
      reply(response, code, result);
    } catch (error) {
      request.resume();
      reply(response, error instanceof ApiError ? error.statusCode : 503,
        errorBody(error instanceof ApiError ? error.code : 'temporarily_unavailable'));
    } finally { active--; }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.timeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}
