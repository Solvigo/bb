# WS1 — stream-probe findings

## Question

Does a bb plugin `http.route` handler hold a **long-lived, incrementally flushed** streaming HTTP
response (MJPEG `multipart/x-mixed-replace`) open for 60+ seconds, or does bb's server buffer,
truncate, or close it?

This is the one unknown from [[theme:browser/plugin-first-transport-decision]] that decides whether
the embedded-browser feature stays 100% in a plugin (YES) or needs one carried server patch (NO).

## Verdict: **PASS** — the stream holds. No server patch needed.

## Rig

- Disposable bb on its own `BB_HARNESS_ROOT`, `BB_MODE=built`, `NODE_ENV=production`,
  ports **39225** (server) / 39226 (host daemon) / 39227 (dev app slot, unused in built mode).
  Its own `bb.db`; no live rows, no live bb touched.
- Plugin `plugins/stream-probe` installed as `path:` from this worktree — server-only
  (`bb.name` + `bb.server`, **no `app`**; the manifest's `app` is optional and the loader accepts
  a server-only plugin). Installed id: `stream-probe`, state `running`.
- Routes: `GET /api/v1/plugins/stream-probe/http/stream` (MJPEG, `auth: "local"`) and
  `.../http/ping` (liveness).
- Synthetic frames only — a fixed 286-byte 2x2 baseline JPEG pushed every 100ms, capped at 900
  frames (~90s), so the 60s window ends while the stream is still open. No Chrome, no CDP.
- Client: `plugins/stream-probe/measure-stream.mjs` (Node v25.9.0 global `fetch`) with an
  `Origin: http://127.0.0.1:39227` header to pass the local-origin gate. It parses the multipart stream
  exactly — it consumes only complete part headers and skips each declared body length — so a
  boundary straddling two TCP chunks cannot be double-counted.

## Primary measurement — 60s window, default (Node/undici) `Accept-Encoding`

| Measure                                                                    | Value                                                                              | Acceptance                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Response status                                                            | 200                                                                                | —                                                      |
| `content-type`                                                             | `multipart/x-mixed-replace; boundary=frame`                                        | round-tripped unchanged                                |
| `transfer-encoding`                                                        | `chunked`                                                                          | chunked, no `content-length`                           |
| `content-encoding`                                                         | none                                                                               | not transformed by hono `compress()`                   |
| Response headers at                                                        | **276ms**                                                                          | —                                                      |
| **First-byte latency**                                                     | **348ms**                                                                          | < 1000ms ✅                                            |
| **Frames received in 60s**                                                 | **592**                                                                            | ~600 expected at 100ms ✅                              |
| TCP/stream chunks                                                          | 591                                                                                | ≈ 1 chunk per frame — flushed per write, not coalesced |
| Bytes                                                                      | 235508                                                                             | —                                                      |
| **Incremental?**                                                           | frames in **12/12** 5s buckets: `[47, 49, 50, 49, 50, 50, 49, 50, 49, 50, 50, 49]` | evenly spread, not one burst ✅                        |
| **Held open?**                                                             | yes — 60006ms elapsed, `closedEarly=False`, `error=None`                           | full 60s ✅                                            |
| Server→client delivery latency (from the per-part `X-Frame-Sent-Ms` stamp) | median **1ms**, p95 **5ms**, max 211ms over 592 frames                             | —                                                      |

The 592-vs-600 frame count is `setInterval` drift plus the 348ms connect, not loss:
the per-bucket counts are a flat ~49–50 per 5s for the whole window.

## Controls — does content negotiation change the answer?

`apps/server/src/server.ts` wraps everything in hono's `compress()`; `api-response-compression.ts`
already excludes `/api/v1/plugins/<id>/http` from its buffered path. Measured both ends of the
negotiation to confirm nothing re-buffers the stream:

| Control                         | `Accept-Encoding` sent | `content-encoding` back | Frames / 20s | Buckets            | First byte | Held open |
| ------------------------------- | ---------------------- | ----------------------- | ------------ | ------------------ | ---------- | --------- |
| `control-20s-identity`          | `identity`             | none                    | 198          | `[49, 50, 49, 50]` | 108ms      | yes       |
| `control-20s-browser-encodings` | `gzip, deflate, br`    | none                    | 198          | `[49, 50, 49, 50]` | 104ms      | yes       |

A browser-shaped `gzip, deflate, br` request is served identically to `identity`: no
`content-encoding`, chunked, incremental. Compression is not a hazard on this route.

## Client disconnect does not leak the producer

Each measurement cancels its reader mid-stream. After three abandoned streams the server process
sampled **0.1% CPU** three times a second apart, and a fresh request starts again at
`X-Frame-Index: 1`. The route's `ReadableStream.cancel()` clears the interval (the `enqueue`
try/catch is the second line of defence), so an abandoned screencast stops producing.

## What this does and does not prove

Proven: a plugin `http.route` returning a `Response` wrapping a `ReadableStream` is held open by
bb's server, flushed per enqueue, chunked, uncompressed, and still open at 60s, under the
`auth: "local"` origin gate — inside bb's real server, not a standalone one
([[theme:browser/ws0-transport-proven]] proved the mechanism on a bare rig; this closes it in bb).

Not covered (out of scope for this spike, stated so the gap is not discovered later):

- Only one concurrent subscriber, and only ~4KB/s. Frame-rate and multi-viewer behaviour of a real
  screencast are unmeasured.
- Local loopback only. No reverse proxy, no remote client, no tunnel — a proxy in front of bb has
  its own buffering and idle-timeout policy.
- 60s, not hours. A multi-hour session and plugin reload/disable mid-stream are untested.
- No Chrome and no CDP, by design.

## Reproduce

```sh
export BB_HARNESS_ROOT=<scratch>/rig BB_CLI=<harness>/bb-instance/bb NODE_ENV=production
# env.local: BB_CHECKOUT=..., BB_MODE=built, ports 39225/39226/39227, BB_SERVER_URL=http://127.0.0.1:39225
<harness>/bb-instance/bbctl start
<harness>/bb-instance/bb plugin install <this-repo>/plugins/stream-probe --yes
node plugins/stream-probe/measure-stream.mjs \
  http://127.0.0.1:39225 http://127.0.0.1:39227 data/ws1-stream-probe/out/stream-holding-result.json
```

## Raw result

The canonical artifact is `data/ws1-stream-probe/out/stream-holding-result.json`. That path is
covered by this repo's root `/data/` gitignore rule, so the same JSON is reproduced verbatim here
rather than force-added to the index:

```json
{
  "question": "Does a bb plugin http.route hold a long-lived, incrementally flushed streaming HTTP response (MJPEG multipart/x-mixed-replace) open for 60+ seconds?",
  "verdict": "PASS",
  "measuredAt": "2026-08-24T18:33:23.454Z",
  "node": "v25.9.0",
  "target": "http://127.0.0.1:39225/api/v1/plugins/stream-probe/http/stream",
  "origin": "http://127.0.0.1:39227",
  "frameIntervalMs": 100,
  "criteria": {
    "firstByteUnder1s": true,
    "framesReceived": 592,
    "frameCountNearExpected": true,
    "incremental": true,
    "heldOpen60s": true
  },
  "primary": {
    "label": "primary-60s-default-encoding",
    "windowMs": 60000,
    "acceptEncodingSent": null,
    "status": 200,
    "contentType": "multipart/x-mixed-replace; boundary=frame",
    "contentEncoding": null,
    "transferEncoding": "chunked",
    "contentLength": null,
    "responseHeadersAtMs": 276,
    "firstByteAtMs": 348,
    "firstFrameAtMs": 348,
    "lastFrameAtMs": 59961,
    "elapsedMs": 60006,
    "chunks": 591,
    "bytes": 235508,
    "frames": 592,
    "framesPer5sBucket": [47, 49, 50, 49, 50, 50, 49, 50, 49, 50, 50, 49],
    "nonEmptyBuckets": 12,
    "bucketCount": 12,
    "deliveryLatencyMs": {
      "samples": 592,
      "min": 0,
      "median": 1,
      "p95": 5,
      "max": 211
    },
    "heldOpenForFullWindow": true,
    "closedEarly": false,
    "error": null
  },
  "controls": [
    {
      "label": "control-20s-identity",
      "windowMs": 20000,
      "acceptEncodingSent": "identity",
      "status": 200,
      "contentType": "multipart/x-mixed-replace; boundary=frame",
      "contentEncoding": null,
      "transferEncoding": "chunked",
      "contentLength": null,
      "responseHeadersAtMs": 9,
      "firstByteAtMs": 108,
      "firstFrameAtMs": 108,
      "lastFrameAtMs": 19953,
      "elapsedMs": 20002,
      "chunks": 198,
      "bytes": 78696,
      "frames": 198,
      "framesPer5sBucket": [49, 50, 49, 50],
      "nonEmptyBuckets": 4,
      "bucketCount": 4,
      "deliveryLatencyMs": {
        "samples": 198,
        "min": 0,
        "median": 1,
        "p95": 2,
        "max": 4
      },
      "heldOpenForFullWindow": true,
      "closedEarly": false,
      "error": null
    },
    {
      "label": "control-20s-browser-encodings",
      "windowMs": 20000,
      "acceptEncodingSent": "gzip, deflate, br",
      "status": 200,
      "contentType": "multipart/x-mixed-replace; boundary=frame",
      "contentEncoding": null,
      "transferEncoding": "chunked",
      "contentLength": null,
      "responseHeadersAtMs": 4,
      "firstByteAtMs": 104,
      "firstFrameAtMs": 104,
      "lastFrameAtMs": 19998,
      "elapsedMs": 20061,
      "chunks": 198,
      "bytes": 78696,
      "frames": 198,
      "framesPer5sBucket": [49, 50, 49, 50],
      "nonEmptyBuckets": 4,
      "bucketCount": 4,
      "deliveryLatencyMs": {
        "samples": 198,
        "min": 0,
        "median": 1,
        "p95": 7,
        "max": 77
      },
      "heldOpenForFullWindow": true,
      "closedEarly": false,
      "error": null
    }
  ]
}
```
