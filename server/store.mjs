import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

/** Single-process store. Never run two bridge instances against the same path. */
export class IdempotencyStore {
  constructor(filePath, { maxRecords = 5000, retentionMs = 86_400_000 } = {}) {
    this.filePath = filePath;
    this.maxRecords = maxRecords;
    this.retentionMs = retentionMs;
    this.entries = new Map();
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('invalid_store');
      for (const [key, value] of data.entries) {
        if (typeof key !== 'string' || typeof value?.hash !== 'string' ||
            !Number.isFinite(value.createdAt) || !['sending', 'complete'].includes(value.phase) ||
            (value.importance !== undefined && !['critical', 'normal'].includes(value.importance)) ||
            (value.response?.importance !== undefined && !['critical', 'normal'].includes(value.response.importance)) ||
            (value.response?.importance !== undefined &&
              (value.importance ?? 'critical') !== value.response.importance)) {
          throw new Error('invalid_store');
        }
        this.entries.set(key, value);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('idempotency_store_unavailable');
    }
  }

  locked(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async persist() {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, entries: [...this.entries] }), { mode: 0o600, flush: true });
    await rename(temporary, this.filePath);
  }

  lookup(key, createdAt) {
    return this.locked(() => {
      const entry = this.entries.get(key);
      return entry && createdAt - entry.createdAt < this.retentionMs ? entry : undefined;
    });
  }

  reserve(key, hash, record) {
    return this.locked(async () => {
      const existing = this.entries.get(key);
      if (existing && record.createdAt - existing.createdAt < this.retentionMs) {
        return { existing };
      }
      if ([...this.entries].some(([id, entry]) => id !== key && entry.alertId === record.alertId)) {
        return { alertIdConflict: true };
      }
      for (const [id, entry] of this.entries) {
        if (record.createdAt - entry.createdAt >= this.retentionMs) this.entries.delete(id);
      }
      if (this.entries.size >= this.maxRecords) throw new Error('idempotency_capacity');
      this.entries.set(key, { ...record, hash, phase: 'sending' });
      try { await this.persist(); } catch {
        this.entries.delete(key);
        throw new Error('idempotency_store_unavailable');
      }
      return { reserved: true };
    });
  }

  complete(key, statusCode, response) {
    return this.locked(async () => {
      const entry = this.entries.get(key);
      if (!entry) throw new Error('idempotency_store_unavailable');
      const previous = { ...entry };
      Object.assign(entry, { phase: 'complete', statusCode, response });
      try { await this.persist(); } catch {
        this.entries.set(key, previous);
        throw new Error('idempotency_store_unavailable');
      }
    });
  }

  findAlert(alertId) {
    for (const entry of this.entries.values()) {
      if (entry.alertId === alertId) return entry;
    }
    return undefined;
  }

  markAckReady(key) {
    return this.locked(async () => {
      const entry = this.entries.get(key);
      if (!entry || entry.phase !== 'sending') throw new Error('idempotency_store_unavailable');
      const previous = entry.ackEnabled;
      entry.ackEnabled = true;
      try { await this.persist(); } catch {
        entry.ackEnabled = previous;
        throw new Error('idempotency_store_unavailable');
      }
    });
  }
}

/** Independent, non-expiring single-process capability ledger. Never silently evict an unacked alert. */
export class AckStore {
  constructor(filePath, { maxRecords = 5000 } = {}) {
    this.filePath = filePath;
    this.maxRecords = maxRecords;
    this.entries = new Map();
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > this.maxRecords) throw new Error();
      for (const [id, value] of data.entries) {
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
            typeof value?.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.tokenHash) ||
            (value.importance !== undefined && !['critical', 'normal'].includes(value.importance)) ||
            (value.acknowledgedAt !== undefined && typeof value.acknowledgedAt !== 'string') ||
            this.entries.has(id)) throw new Error();
        this.entries.set(id, value);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('ack_store_unavailable');
    }
  }

  locked(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async persist() {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, entries: [...this.entries] }), { mode: 0o600, flush: true });
    await rename(temporary, this.filePath);
  }

  reserve(id, tokenHash, importance = 'critical') {
    return this.locked(async () => {
      if (!['critical', 'normal'].includes(importance)) throw new Error('invalid_importance');
      if (this.entries.has(id)) return false;
      if (this.entries.size >= this.maxRecords) throw new Error('ack_capacity');
      this.entries.set(id, { tokenHash, importance });
      try { await this.persist(); } catch {
        this.entries.delete(id);
        throw new Error('ack_store_unavailable');
      }
      return true;
    });
  }

  get(id) { return this.entries.get(id); }

  setImportance(id, importance) {
    return this.locked(async () => {
      const entry = this.entries.get(id);
      if (!entry || entry.importance !== undefined || !['critical', 'normal'].includes(importance)) {
        throw new Error('ack_store_unavailable');
      }
      entry.importance = importance;
      try { await this.persist(); } catch {
        delete entry.importance;
        throw new Error('ack_store_unavailable');
      }
    });
  }

  authorized(id, tokenHash) {
    const entry = this.entries.get(id);
    return !!entry && typeof tokenHash === 'string' && /^[a-f0-9]{64}$/.test(tokenHash) &&
      timingSafeEqual(Buffer.from(entry.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'));
  }

  receipt(id) {
    // Status readers participate in the same queue: no uncommitted acknowledgement is exposed.
    return this.locked(async () => {
      const entry = this.entries.get(id);
      return entry ? { ...entry } : undefined;
    });
  }

  acknowledge(id, tokenHash, clientAckedAt, now, clientActionId) {
    return this.locked(async () => {
      const entry = this.entries.get(id);
      if (!this.authorized(id, tokenHash)) return undefined;
      if (entry.acknowledgedAt) return { alert_id: id, status: 'acknowledged', acknowledged_at: entry.acknowledgedAt,
        ...(entry.clientActionId ? { client_action_id: entry.clientActionId } : {}),
        ...(entry.clientAckedAt ? { client_acked_at: entry.clientAckedAt } : {}) };
      const previous = { ...entry };
      entry.acknowledgedAt = new Date(now()).toISOString();
      if (clientAckedAt) entry.clientAckedAt = clientAckedAt;
      if (clientActionId) entry.clientActionId = clientActionId;
      try { await this.persist(); } catch {
        this.entries.set(id, previous);
        throw new Error('ack_store_unavailable');
      }
      return { alert_id: id, status: 'acknowledged', acknowledged_at: entry.acknowledgedAt,
        ...(entry.clientActionId ? { client_action_id: entry.clientActionId } : {}),
        ...(entry.clientAckedAt ? { client_acked_at: entry.clientAckedAt } : {}) };
    });
  }
}
