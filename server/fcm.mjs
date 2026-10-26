import { createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export class SendFailure extends Error {
  constructor(code, ambiguous = false) {
    super(code);
    this.code = code;
    this.ambiguous = ambiguous;
  }
}

/** Service-account material never appears in API errors, logs or state files. */
export async function createFcmSender({ credentialsPath, deviceToken, fetchImpl = fetch }) {
  let account;
  let key;
  try {
    account = JSON.parse(await readFile(credentialsPath, 'utf8'));
    if (account.type !== 'service_account' ||
        !/^[a-z][a-z0-9-]{4,62}$/.test(account.project_id ?? '') ||
        typeof account.client_email !== 'string' || !account.client_email.includes('@') ||
        typeof deviceToken !== 'string' || !deviceToken.trim()) throw new Error();
    key = createPrivateKey(account.private_key);
  } catch {
    throw new Error('invalid_fcm_configuration');
  }
  let cachedToken;
  let cachedUntil = 0;
  let refreshing;
  async function accessToken() {
    if (cachedToken && Date.now() < cachedUntil) return cachedToken;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const now = Math.floor(Date.now() / 1000);
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
        iss: account.client_email, scope: SCOPE, aud: OAUTH_URL, iat: now, exp: now + 3600,
      })}`;
      const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
      let response;
      try {
        response = await fetchImpl(OAUTH_URL, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (typeof data.access_token !== 'string' || !data.access_token ||
            !Number.isFinite(data.expires_in) || data.expires_in < 60) throw new Error();
        cachedToken = data.access_token;
        cachedUntil = Date.now() + Math.min(data.expires_in - 30, 3500) * 1000;
        return cachedToken;
      } catch {
        // No FCM request was attempted; OAuth failures are not delivery ambiguity.
        throw new SendFailure('provider_authentication_failed');
      }
    })();
    try { return await refreshing; } finally { refreshing = undefined; }
  }

  return async function send({ data, ttlSeconds }) {
    if (data.importance !== 'normal' && data.importance !== 'critical') throw new SendFailure('invalid_importance');
    const token = await accessToken();
    const remaining = Math.min(ttlSeconds, Math.floor((Date.parse(data.expires_at) - Date.now()) / 1000));
    if (!Number.isFinite(remaining) || remaining <= 0) throw new SendFailure('expired_before_send');
    let response;
    try {
      response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: {
          token: deviceToken,
          data,
          android: { priority: data.importance === 'normal' ? 'NORMAL' : 'HIGH', ttl: `${remaining}s` },
        } }),
      });
    } catch {
      throw new SendFailure('provider_delivery_unknown', true);
    }
    if (!response.ok) {
      // Do not expose provider response bodies: they can contain token/project data.
      if (response.status === 401) { cachedToken = undefined; cachedUntil = 0; }
      throw new SendFailure('provider_rejected');
    }
    try {
      const result = await response.json();
      if (typeof result.name !== 'string' || !result.name) throw new Error();
      // Provider message names are not needed by this PoC's public receipt.
      return { accepted: true };
    } catch {
      throw new SendFailure('provider_delivery_unknown', true);
    }
  };
}
