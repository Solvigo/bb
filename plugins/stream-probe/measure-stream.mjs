#!/usr/bin/env node
// Measures whether a bb plugin `http.route` holds a long-lived, incrementally
// flushed MJPEG response open. Usage:
//   node measure-stream.mjs <base-url> <origin> <out-file>
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:39225";
const ORIGIN = process.argv[3] ?? "http://127.0.0.1:39227";
const OUT = process.argv[4] ?? "stream-holding-result.json";
const URL_ = `${BASE}/api/v1/plugins/stream-probe/http/stream`;
const BOUNDARY = Buffer.from("--frame\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");
const CONTENT_LENGTH = /Content-Length: (\d+)/u;
const SENT_MS = /X-Frame-Sent-Ms: (\d+)/u;

/** One streamed read of the probe route, capped at `windowMs`. */
async function run({ label, windowMs, acceptEncoding }) {
  const headers = { Origin: ORIGIN };
  if (acceptEncoding !== null) headers["accept-encoding"] = acceptEncoding;

  const t0 = Date.now();
  const response = await fetch(URL_, { headers });
  const headersAtMs = Date.now() - t0;

  const buckets = new Array(Math.ceil(windowMs / 5000)).fill(0);
  const deliveryLatenciesMs = [];
  let firstByteAtMs = null;
  let firstFrameAtMs = null;
  let lastFrameAtMs = null;
  let frames = 0;
  let bytes = 0;
  let chunks = 0;
  let pending = Buffer.alloc(0);
  let skipBytes = 0;
  let closedEarly = false;
  let error = null;
  let windowExpired = false;

  const reader = response.body.getReader();
  const deadline = t0 + windowMs;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        windowExpired = true;
        break;
      }
      const timeout = new Promise((resolve) =>
        setTimeout(() => resolve("__timeout__"), remaining).unref(),
      );
      const next = await Promise.race([reader.read(), timeout]);
      if (next === "__timeout__") {
        windowExpired = true;
        break;
      }
      if (next.done) {
        closedEarly = true;
        break;
      }
      const at = Date.now() - t0;
      chunks += 1;
      bytes += next.value.byteLength;
      if (firstByteAtMs === null) firstByteAtMs = at;

      // Exact incremental multipart parse: consume only complete part
      // headers, so a boundary straddling two chunks is counted once.
      pending =
        pending.length === 0
          ? Buffer.from(next.value)
          : Buffer.concat([pending, next.value]);
      for (;;) {
        if (skipBytes > 0) {
          const drop = Math.min(skipBytes, pending.length);
          pending = pending.subarray(drop);
          skipBytes -= drop;
          if (skipBytes > 0) break;
        }
        const start = pending.indexOf(BOUNDARY);
        if (start === -1) break;
        const headerEnd = pending.indexOf(HEADER_END, start);
        if (headerEnd === -1) break;
        const header = pending.toString("latin1", start, headerEnd);
        const sent = SENT_MS.exec(header);
        const length = CONTENT_LENGTH.exec(header);
        if (sent === null || length === null) {
          error = error ?? `malformed part header: ${JSON.stringify(header)}`;
          pending = pending.subarray(headerEnd + HEADER_END.length);
          continue;
        }
        frames += 1;
        deliveryLatenciesMs.push(t0 + at - Number(sent[1]));
        if (firstFrameAtMs === null) firstFrameAtMs = at;
        lastFrameAtMs = at;
        buckets[Math.min(Math.floor(at / 5000), buckets.length - 1)] += 1;
        // Skip the JPEG body so its bytes can never look like a boundary,
        // carrying the deficit when the body spans the next chunk.
        const bodyStart = headerEnd + HEADER_END.length;
        pending = pending.subarray(bodyStart);
        skipBytes = Number(length[1]);
      }
    }
  } catch (cause) {
    error = `${cause.name}: ${cause.message}`;
  } finally {
    await reader.cancel().catch(() => {});
  }

  const elapsedMs = Date.now() - t0;
  const sorted = [...deliveryLatenciesMs].sort((a, b) => a - b);
  const percentile = (p) =>
    sorted.length === 0
      ? null
      : sorted[
          Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))
        ];
  const nonEmptyBuckets = buckets.filter((count) => count > 0).length;

  return {
    label,
    windowMs,
    acceptEncodingSent: acceptEncoding,
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentEncoding: response.headers.get("content-encoding"),
    transferEncoding: response.headers.get("transfer-encoding"),
    contentLength: response.headers.get("content-length"),
    responseHeadersAtMs: headersAtMs,
    firstByteAtMs,
    firstFrameAtMs,
    lastFrameAtMs,
    elapsedMs,
    chunks,
    bytes,
    frames,
    framesPer5sBucket: buckets,
    nonEmptyBuckets,
    bucketCount: buckets.length,
    deliveryLatencyMs: {
      samples: sorted.length,
      min: sorted[0] ?? null,
      median: percentile(50),
      p95: percentile(95),
      max: sorted.at(-1) ?? null,
    },
    heldOpenForFullWindow: windowExpired && !closedEarly && error === null,
    closedEarly,
    error,
  };
}

const main = await run({
  label: "primary-60s-default-encoding",
  windowMs: 60_000,
  acceptEncoding: null,
});
const controls = [
  await run({
    label: "control-20s-identity",
    windowMs: 20_000,
    acceptEncoding: "identity",
  }),
  await run({
    label: "control-20s-browser-encodings",
    windowMs: 20_000,
    acceptEncoding: "gzip, deflate, br",
  }),
];

// PASS requires all four acceptance criteria from the brief, measured — not assumed.
const criteria = {
  firstByteUnder1s: main.firstByteAtMs !== null && main.firstByteAtMs < 1000,
  framesReceived: main.frames,
  // ~600 expected at 100ms over 60s; allow for scheduler jitter and startup.
  frameCountNearExpected: main.frames >= 500 && main.frames <= 620,
  // Incremental = frames landed in (nearly) every 5s bucket, not one burst.
  incremental: main.nonEmptyBuckets >= main.bucketCount - 1,
  heldOpen60s: main.heldOpenForFullWindow && main.elapsedMs >= 59_500,
};
const verdict = Object.entries(criteria).every(([key, value]) =>
  key === "framesReceived" ? true : value === true,
)
  ? "PASS"
  : "FAIL";

const result = {
  question:
    "Does a bb plugin http.route hold a long-lived, incrementally flushed streaming HTTP response (MJPEG multipart/x-mixed-replace) open for 60+ seconds?",
  verdict,
  measuredAt: new Date().toISOString(),
  node: process.version,
  target: URL_,
  origin: ORIGIN,
  frameIntervalMs: 100,
  criteria,
  primary: main,
  controls,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ verdict, criteria, primary: main }, null, 2));
