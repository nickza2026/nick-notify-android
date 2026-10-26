import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createBridge } from './api.mjs';
import { createFcmSender } from './fcm.mjs';

export async function startFromEnvironment(env = process.env) {
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_port');
  const host = env.HOST ?? '127.0.0.1';
  // Network exposure must be an explicit operational choice; TLS belongs at a reverse proxy.
  let sender;
  if (env.GOOGLE_APPLICATION_CREDENTIALS && env.FCM_DEVICE_TOKEN) {
    sender = await createFcmSender({ credentialsPath: env.GOOGLE_APPLICATION_CREDENTIALS, deviceToken: env.FCM_DEVICE_TOKEN });
  }
  const server = await createBridge({
    apiKey: env.ALERT_API_KEY,
    sender,
    statePath: env.ALERT_STATE_PATH ?? fileURLToPath(new URL('./.data/idempotency.json', import.meta.url)),
    ackBaseUrl: env.ACK_PUBLIC_BASE_URL,
    ackStatePath: env.ACK_STATE_PATH,
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); });
  console.log('Notify Alarm PoC bridge started. Health reports configuration only; no device delivery is verified.');
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startFromEnvironment().then(server => {
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      // Stop accepting new requests and allow in-flight provider/state work to settle.
      // An interrupted attempt remains reserved in durable state, never blindly resent.
      const deadline = setTimeout(() => {
        server.closeAllConnections();
        process.exit(1);
      }, 25_000);
      deadline.unref();
      server.close(error => {
        clearTimeout(deadline);
        process.exit(error ? 1 : 0);
      });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }).catch(() => {
    console.error('Bridge startup failed. Check API key (minimum 32 bytes), configuration, state storage and port. Secrets are not logged.');
    process.exitCode = 1;
  });
}
