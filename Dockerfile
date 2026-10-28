# Match the tested Node 22 runtime. Refresh this pin after a vulnerability scan;
# a version pin is reproducible, not a claim that the base has no vulnerabilities.
FROM node:22.23.4-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    ALERT_STATE_PATH=/data/idempotency.json

WORKDIR /app

# No external npm dependencies. Copy an explicit runtime allowlist, never the
# repository, Android build output, local configuration or credentials.
COPY --chown=0:0 server/index.mjs server/api.mjs server/fcm.mjs server/store.mjs ./server/
RUN mkdir /data && chown 1000:1000 /data && chmod 0700 /data \
    && chmod 0555 /app /app/server && chmod 0444 /app/server/*.mjs

USER 1000:1000
EXPOSE 8787
STOPSIGNAL SIGTERM

# Liveness only: ready=false is deliberately still a healthy HTTP server.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "try { const r = await fetch('http://127.0.0.1:8787/health', {signal: AbortSignal.timeout(3000)}); process.exit(r.ok ? 0 : 1); } catch { process.exit(1); }"]

ENTRYPOINT ["node", "server/index.mjs"]
