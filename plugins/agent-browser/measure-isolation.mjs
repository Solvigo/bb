#!/usr/bin/env node
// The acceptance client for the agent-browser plugin: two threads, two streams,
// one browser — and nothing crossing between them.
//
//   node measure-isolation.mjs <bb-base-url> <origin> <thread-a> <thread-b> <out-file> [page-port]
//
// It serves its own two local pages, so nothing here depends on the network.
// Each page animates on requestAnimationFrame, which is also what makes the
// streams prove the liveness fix: a backgrounded headless target throttles rAF
// to 0fps unless the session applies focus emulation, and a frozen page emits
// no screencast frames at all.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:39235";
const ORIGIN = process.argv[3] ?? "http://127.0.0.1:39237";
const THREAD_A = process.argv[4];
const THREAD_B = process.argv[5];
const OUT = process.argv[6] ?? "isolation-result.json";
const PAGE_PORT = Number(process.argv[7] ?? 39238);
const PLUGIN = "agent-browser";
const WINDOW_MS = 20_000;
const BUCKET_MS = 5_000;
const TYPED_TEXT = "hello-A";
const INPUT_AT = { x: 220, y: 100 };

if (!THREAD_A || !THREAD_B) {
  console.error(
    "usage: measure-isolation.mjs <bb-base-url> <origin> <thread-a> <thread-b> <out-file> [page-port]",
  );
  process.exit(2);
}

const pageBase = `http://127.0.0.1:${PAGE_PORT}`;
const BOUNDARY = Buffer.from("--frame\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");
const CONTENT_LENGTH = /Content-Length: (\d+)/u;

function guestPage(who) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>GUEST-PAGE-${who}</title>
<style>
 body{margin:0;font-family:system-ui;background:${who === "A" ? "#08402a" : "#2a0840"};color:#fff}
 h1{position:absolute;left:20px;top:16px;font-size:34px}
 #box{position:absolute;left:20px;top:80px;width:400px;height:40px;font-size:20px}
 #log{position:absolute;left:20px;top:140px;font-size:26px}
 #tick{position:absolute;left:20px;top:190px;font-size:26px}
</style></head><body>
<h1>GUEST-PAGE-${who}</h1><input id="box"><div id="log">log:</div><div id="tick">tick 0</div>
<script>
 const box=document.getElementById("box");
 const log=document.getElementById("log");
 const tick=document.getElementById("tick");
 box.addEventListener("input",()=>{log.textContent="log:"+box.value});
 let frame=0;
 const paint=()=>{tick.textContent="tick "+(++frame);requestAnimationFrame(paint)};
 requestAnimationFrame(paint);
</script></body></html>`;
}

const pageServer = createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0];
  if (path === "/a" || path === "/b") {
    const who = path === "/a" ? "A" : "B";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": `who=${who}; Path=/; SameSite=Lax`,
      "cache-control": "no-store",
    });
    response.end(guestPage(who));
    return;
  }
  if (path === "/cookies") {
    const cookie = request.headers.cookie ?? "none";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>COOKIES</title></head><body style="font-family:system-ui;font-size:28px">cookies:${cookie}</body></html>`,
    );
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

await new Promise((resolve) => pageServer.listen(PAGE_PORT, "127.0.0.1", resolve));

async function rpc(method, input) {
  const response = await fetch(`${BASE}/api/v1/plugins/${PLUGIN}/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (body.ok !== true) {
    throw new Error(`${method} failed: ${JSON.stringify(body.error ?? body)}`);
  }
  return body.result;
}

async function postInput(threadId, event) {
  const response = await fetch(
    `${BASE}/api/v1/plugins/${PLUGIN}/http/sessions/input?threadId=${threadId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(event),
    },
  );
  const body = await response.json();
  if (response.status !== 200) {
    throw new Error(`input failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

/** One MJPEG subscription, parsed exactly and kept open for `windowMs`. */
async function measureStream({ label, threadId, windowMs, frameFile }) {
  const target = `${BASE}/api/v1/plugins/${PLUGIN}/http/sessions/stream?threadId=${threadId}`;
  const startedAt = Date.now();
  const response = await fetch(target, { headers: { Origin: ORIGIN } });
  const headersAtMs = Date.now() - startedAt;
  const buckets = new Array(Math.ceil(windowMs / BUCKET_MS)).fill(0);
  const frameHashes = new Set();

  let firstByteAtMs = null;
  let firstFrameAtMs = null;
  let lastFrameAtMs = null;
  let frames = 0;
  let bytes = 0;
  let chunks = 0;
  let pending = Buffer.alloc(0);
  let bodyRemaining = 0;
  let bodyParts = [];
  let closedEarly = false;
  let windowExpired = false;
  let error = null;
  let lastFrame = null;

  if (response.status !== 200) {
    return {
      label,
      threadId,
      status: response.status,
      error: `unexpected status: ${JSON.stringify(await response.json().catch(() => null))}`,
      frames: 0,
      heldOpenForFullWindow: false,
    };
  }

  const reader = response.body.getReader();
  const deadline = startedAt + windowMs;
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
      const at = Date.now() - startedAt;
      chunks += 1;
      bytes += next.value.byteLength;
      if (firstByteAtMs === null) firstByteAtMs = at;
      pending =
        pending.length === 0
          ? Buffer.from(next.value)
          : Buffer.concat([pending, next.value]);

      // Exact incremental parse: a part is counted once its declared body has
      // arrived in full, so a boundary straddling two chunks cannot double-count
      // and jpeg bytes can never be mistaken for a boundary.
      for (;;) {
        if (bodyRemaining > 0) {
          const take = Math.min(bodyRemaining, pending.length);
          bodyParts.push(pending.subarray(0, take));
          pending = pending.subarray(take);
          bodyRemaining -= take;
          if (bodyRemaining > 0) break;
          const jpeg = Buffer.concat(bodyParts);
          bodyParts = [];
          frames += 1;
          lastFrame = jpeg;
          frameHashes.add(createHash("sha256").update(jpeg).digest("hex"));
          if (firstFrameAtMs === null) firstFrameAtMs = at;
          lastFrameAtMs = at;
          buckets[Math.min(Math.floor(at / BUCKET_MS), buckets.length - 1)] += 1;
        }
        const start = pending.indexOf(BOUNDARY);
        if (start === -1) break;
        const headerEnd = pending.indexOf(HEADER_END, start);
        if (headerEnd === -1) break;
        const header = pending.toString("latin1", start, headerEnd);
        const length = CONTENT_LENGTH.exec(header);
        pending = pending.subarray(headerEnd + HEADER_END.length);
        if (length === null) {
          error = error ?? `malformed part header: ${JSON.stringify(header)}`;
          continue;
        }
        bodyRemaining = Number(length[1]);
      }
    }
  } catch (cause) {
    error = `${cause.name}: ${cause.message}`;
  } finally {
    await reader.cancel().catch(() => {});
  }

  // A frame off the wire, kept as evidence: these are the streamed pixels, not
  // a screenshot taken beside them.
  if (frameFile !== undefined && lastFrame !== null) {
    await mkdir(dirname(frameFile), { recursive: true });
    await writeFile(frameFile, lastFrame);
  }

  const nonEmptyBuckets = buckets.filter((count) => count > 0).length;
  return {
    frameFile: lastFrame === null ? null : frameFile,
    label,
    threadId,
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentEncoding: response.headers.get("content-encoding"),
    transferEncoding: response.headers.get("transfer-encoding"),
    responseHeadersAtMs: headersAtMs,
    firstByteAtMs,
    firstFrameAtMs,
    lastFrameAtMs,
    elapsedMs: Date.now() - startedAt,
    chunks,
    bytes,
    frames,
    distinctFrames: frameHashes.size,
    frameHashes: [...frameHashes],
    framesPer5sBucket: buckets,
    nonEmptyBuckets,
    bucketCount: buckets.length,
    heldOpenForFullWindow: windowExpired && !closedEarly && error === null,
    closedEarly,
    error,
  };
}

function incremental(stream) {
  return (
    stream.nonEmptyBuckets !== undefined &&
    stream.nonEmptyBuckets >= stream.bucketCount - 1 &&
    stream.frames > stream.bucketCount
  );
}

const result = {
  question:
    "Does the agent-browser plugin serve two threads two concurrently held, incrementally flushed screencast streams from two genuinely isolated browser contexts?",
  measuredAt: new Date().toISOString(),
  node: process.version,
  bbBaseUrl: BASE,
  origin: ORIGIN,
  pageBase,
  threads: { a: THREAD_A, b: THREAD_B },
};

try {
  result.open = {
    a: await rpc("open", { threadId: THREAD_A, url: `${pageBase}/a` }),
    b: await rpc("open", { threadId: THREAD_B, url: `${pageBase}/b` }),
  };

  // Both streams are opened before either is read, so they are genuinely
  // concurrent rather than one after the other.
  const frameDirectory = dirname(OUT);
  const [streamA, streamB] = await Promise.all([
    measureStream({
      label: "thread-a",
      threadId: THREAD_A,
      windowMs: WINDOW_MS,
      frameFile: `${frameDirectory}/stream-frame-thread-a.jpg`,
    }),
    measureStream({
      label: "thread-b",
      threadId: THREAD_B,
      windowMs: WINDOW_MS,
      frameFile: `${frameDirectory}/stream-frame-thread-b.jpg`,
    }),
  ]);
  result.streams = { a: streamA, b: streamB };
  const sharedFrames = (streamA.frameHashes ?? []).filter((hash) =>
    (streamB.frameHashes ?? []).includes(hash),
  );

  const snapshotsWhileStreaming = {
    a: await rpc("snapshot", { threadId: THREAD_A }),
    b: await rpc("snapshot", { threadId: THREAD_B }),
  };
  result.snapshots = { afterOpen: snapshotsWhileStreaming };

  // Input goes to A's page: click A's text box, then type into it.
  await postInput(THREAD_A, {
    kind: "mouse",
    type: "mousePressed",
    x: INPUT_AT.x,
    y: INPUT_AT.y,
    button: "left",
    clickCount: 1,
  });
  await postInput(THREAD_A, {
    kind: "mouse",
    type: "mouseReleased",
    x: INPUT_AT.x,
    y: INPUT_AT.y,
    button: "left",
    clickCount: 1,
  });
  await postInput(THREAD_A, { kind: "text", text: TYPED_TEXT });
  const afterInput = {
    a: await rpc("snapshot", { threadId: THREAD_A }),
    b: await rpc("snapshot", { threadId: THREAD_B }),
  };
  result.snapshots.afterInput = afterInput;

  // Cookie isolation: each page set `who=<its own letter>` when it loaded. If
  // the two threads shared a cookie jar, whichever loaded last would win in
  // both.
  await rpc("navigate", { threadId: THREAD_A, url: `${pageBase}/cookies` });
  await rpc("navigate", { threadId: THREAD_B, url: `${pageBase}/cookies` });
  const cookies = {
    a: await rpc("snapshot", { threadId: THREAD_A }),
    b: await rpc("snapshot", { threadId: THREAD_B }),
  };
  result.snapshots.cookies = cookies;

  // An unknown thread must be refused, not quietly given a browser context.
  const unknown = await fetch(
    `${BASE}/api/v1/plugins/${PLUGIN}/http/sessions/stream?threadId=thr_not_a_real_thread`,
    { headers: { Origin: ORIGIN } },
  );
  result.unknownThread = {
    status: unknown.status,
    body: await unknown.json().catch(() => null),
  };

  result.closed = {
    a: await rpc("close", { threadId: THREAD_A }),
    b: await rpc("close", { threadId: THREAD_B }),
    secondCloseOfA: await rpc("close", { threadId: THREAD_A }),
  };

  // Thread teardown must dispose the session — nothing else in the surface
  // does, and an orphaned context keeps its cookies for the life of the
  // process. Destructive on purpose, and last: THREAD_A is deleted here.
  await rpc("open", { threadId: THREAD_A, url: `${pageBase}/a` });
  const deleted = await fetch(`${BASE}/api/v1/threads/${THREAD_A}`, {
    method: "DELETE",
    headers: { "content-type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ childThreadsConfirmed: true }),
  });
  let sessionSurvivedTeardown = true;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    // `close` reporting nothing to close is how "the session is gone" is
    // observed; reporting a close would mean teardown left it behind.
    const probe = await rpc("close", { threadId: THREAD_A });
    if (probe.closed === false) {
      sessionSurvivedTeardown = false;
      break;
    }
  }
  result.threadTeardown = {
    deleteStatus: deleted.status,
    sessionSurvivedTeardown,
  };

  result.criteria = {
    bothStreamsHeldOpen:
      streamA.heldOpenForFullWindow === true &&
      streamB.heldOpenForFullWindow === true,
    bothStreamsIncremental: incremental(streamA) && incremental(streamB),
    twoIsolatedContexts:
      result.open.a.targetId !== result.open.b.targetId &&
      sharedFrames.length === 0,
    differentPages:
      snapshotsWhileStreaming.a.url === `${pageBase}/a` &&
      snapshotsWhileStreaming.b.url === `${pageBase}/b` &&
      snapshotsWhileStreaming.a.title === "GUEST-PAGE-A" &&
      snapshotsWhileStreaming.b.title === "GUEST-PAGE-B",
    noCookieCrossover:
      cookies.a.text.includes("who=A") &&
      !cookies.a.text.includes("who=B") &&
      cookies.b.text.includes("who=B") &&
      !cookies.b.text.includes("who=A"),
    inputLandedInAOnly:
      afterInput.a.text.includes(`log:${TYPED_TEXT}`) &&
      !afterInput.b.text.includes(TYPED_TEXT),
    unknownThreadRefused: result.unknownThread.status === 404,
    closeIsHonest:
      result.closed.a.closed === true &&
      result.closed.secondCloseOfA.closed === false,
    threadTeardownClosesSession:
      deleted.status === 200 && sessionSurvivedTeardown === false,
  };
  result.sharedFrameHashes = sharedFrames;
  result.verdict = Object.values(result.criteria).every(
    (value) => value === true,
  )
    ? "PASS"
    : "FAIL";
} catch (error) {
  result.verdict = "FAIL";
  result.error = `${error.name}: ${error.message}`;
} finally {
  pageServer.close();
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      verdict: result.verdict,
      criteria: result.criteria ?? null,
      error: result.error ?? null,
      streams: result.streams
        ? {
            a: {
              frames: result.streams.a.frames,
              buckets: result.streams.a.framesPer5sBucket,
              heldOpen: result.streams.a.heldOpenForFullWindow,
            },
            b: {
              frames: result.streams.b.frames,
              buckets: result.streams.b.framesPer5sBucket,
              heldOpen: result.streams.b.heldOpenForFullWindow,
            },
          }
        : null,
    },
    null,
    2,
  ),
);
process.exit(result.verdict === "PASS" ? 0 : 1);
