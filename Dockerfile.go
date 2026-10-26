# Go + PostgreSQL image. Production uses an external PostgreSQL, never embedded test binaries.
FROM golang:1.25.0-bookworm AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/*.go ./
COPY backend/migrations ./migrations
COPY backend/cmd/notify-api ./cmd/notify-api
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/notify-api ./cmd/notify-api

FROM gcr.io/distroless/static-debian12:nonroot
ENV HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=build --chown=0:0 /out/notify-api /app/notify-api
USER 65532:65532
EXPOSE 8787
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/notify-api"]
