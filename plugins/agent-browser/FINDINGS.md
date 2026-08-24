# agent-browser — the surface, and what was measured

A per-**thread** browser session service, entirely inside a bb plugin. One headless Chrome owned by
`bb.background.service`; one isolated CDP browser context per thread (its own cookie jar and
storage); the page streamed to viewers as MJPEG over `bb.http.route`; input POSTed back to the same
page; four control verbs aligned with bb's `bb browser` grammar.

No server or core change: nothing outside `plugins/agent-browser` moves, except one
`bb-plugin-agent-browser#typecheck` edge in `turbo.json` so the package sees the plugin-SDK
declaration bundle — the same entry every other plugin has.

## The surface

| | |
|---|---|
| `GET /api/v1/plugins/agent-browser/http/sessions/stream?threadId=…` | `multipart/x-mixed-replace` jpeg frames, `auth: "local"` |
| `POST /api/v1/plugins/agent-browser/http/sessions/input?threadId=…` | `{kind: "mouse" \| "key" \| "text", …}` → `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText` |
| `POST /api/v1/plugins/agent-browser/rpc/{open,navigate,snapshot,close}` | the operator's control verbs |
| `bb agent-browser {open,navigate,snapshot,close}` | the same verbs for an agent, on its own thread |
| settings `chromePath`, `remoteDebuggingPort` | which Chrome, and on which loopback port |

Every verb and field name lives in `grammar.ts`; conforming to bb's grammar later is an edit in that
one file. Four names are ours and carry `PROPOSE-UPSTREAM:` notes there — `navigate`, the input
channel behind bb's `click`/`type`, the `snapshot` payload, and the `agent-browser` command name
(bb's plan claims the core `bb browser` namespace for the desktop-composited browser, so this plugin
does not squat it).

`createdBy` is derived, never accepted: an rpc call is the operator (`"cli"`), a CLI call bb handed a
thread context to is that thread's agent (`"agent"`), and a CLI call naming someone else's
`--thread` is the operator again. `visible` is derived too — a session is visible exactly while at
least one viewer holds its frame stream open.

Discoverability: this is not a builtin plugin (the brief forbids touching core, and
`BUILTIN_PLUGINS` lives in `apps/server`), so its CLI command is published through bb's generated
`plugin-commands` skill and its settings through `bb plugin settings` — the bb-guide and bb-cli-skill
chapters that `docs/cli-guide-and-skill.md` names document bb's own builtins, not path-installed
plugins.

## Acceptance: two threads, two streams, nothing crossing

Rig: disposable bb on its own `BB_HARNESS_ROOT`, `BB_MODE=built` + `NODE_ENV=production`, ports
39235 (server) / 39236 (host daemon) / 39237 (dev-app slot, dark in built mode), its own `bb.db`, no
live rows. Plugin installed as `path:` from this worktree. Its own headless Chrome 151 on
127.0.0.1:**39222** — the operator's GUI Chrome on 9222 was verified still owned by its own process
and never touched. Two synthetic `threads` rows over one synthetic
`projects` row, `environment_id` NULL. The run below used `thr_ws1_e` / `thr_ws1_f`.

Client: `measure-isolation.mjs`, which serves its own two local pages (distinct titles, distinct
background colours, each setting `who=A`/`who=B`, each animating on `requestAnimationFrame`) and
parses the multipart streams exactly — a part is counted once its declared body has fully arrived,
so a boundary straddling two TCP chunks cannot double-count and jpeg bytes can never be read as a
boundary.

**Verdict: PASS — 9/9 criteria.** Measured 2026-08-24T19:56:30Z, Node v25.9.0.

| Criterion | Evidence |
|---|---|
| `bothStreamsHeldOpen` | both 200, `multipart/x-mixed-replace; boundary=frame`, chunked, no `content-encoding`; 20053ms / 20044ms elapsed, `closedEarly=false`, `error=null` |
| `bothStreamsIncremental` | A: 452 frames in 4/4 five-second buckets `[73, 210, 59, 110]`; B: 446 in `[73, 206, 53, 114]`. First byte 318ms / 324ms — first frame at the same millisecond as the first byte, i.e. the forced initial paint |
| `twoIsolatedContexts` | two distinct `targetId`s from two distinct `browserContextId`s, and **0 frame hashes in common** across 452 + 446 frames (all 898 distinct) |
| `differentPages` | snapshot A `url=…/a`, `title=GUEST-PAGE-A`; snapshot B `url=…/b`, `title=GUEST-PAGE-B` |
| `noCookieCrossover` | after both pages set their own cookie and both navigated to `/cookies`: A reads `cookies:who=A`, B reads `cookies:who=B`. A shared jar would have shown whichever loaded last in both |
| `inputLandedInAOnly` | click + `insertText` POSTed to A only: A's text becomes `GUEST-PAGE-A\nlog:hello-A\n…`, B's stays `GUEST-PAGE-B\nlog:\n…` |
| `unknownThreadRefused` | `?threadId=thr_not_a_real_thread` → **404** `{"error":"unknown_thread"}`, and no browser context spent |
| `closeIsHonest` | first close `{closed:true, target:{…}}`, second close of the same thread `{closed:false, target:null}` |
| `threadTeardownClosesSession` | `DELETE /threads/<thread-a>` → 200, and the session was gone on the next probe (`close` reporting nothing to close) |

Throughput, for scale rather than as a target: ~22 fps per stream with two streams live, 5.3MB and
5.4MB over 20s (≈0.27MB/s each) at jpeg quality 60, 1280x800. An earlier run on a quieter box
reached ~46 fps and ~0.55MB/s per stream, so this is a floor under load, not a ceiling.

The liveness fix is visible in the numbers, not just applied: the streamed pages are never the
foreground tab, and their `requestAnimationFrame` counters still reached `tick 2563` / `tick 2396`
during the run. Without `Emulation.setFocusEmulationEnabled` + `Page.setWebLifecycleState` a
backgrounded headless target throttles rAF to 0fps, and since a screencast only emits on visual
change, both streams would have delivered one frame and then nothing.

Pixel evidence, written by the run itself: `stream-frame-thread-a.jpg` and
`stream-frame-thread-b.jpg` under `data/ws1-backend-plugin/out/` are the last frames off the two
wires — visibly two different pages. `session-A.png` beside them is a shot from the harness's own
`tools/capture-gate.mjs` driven against the plugin's Chrome on 39222, gated on guest-page content
(`document.title === 'GUEST-PAGE-A'` plus a rAF counter past 30), so a blank tab could not have
passed.

## Two things reality corrected

1. **A plugin `http.route` path parameter never matches.** bb dispatches plugin routes on an exact
   method+path comparison (`getHttpRoute` in
   `apps/server/src/services/plugins/plugin-service.ts`), so `/sessions/:threadId/stream` 404s with
   `has no GET route for "/sessions/thr_…/stream"`. The thread rides the query string instead.
2. **Headless Chrome 151 writes no `DevToolsActivePort` when given a fixed port.** Reading that file
   unconditionally left the service in a 20s-timeout restart loop with a healthy Chrome answering on
   39222 the whole time. It is now read only for port 0, where Chrome does write it (measured).

## Reproduce

```sh
export BB_HARNESS_ROOT=<scratch>/rig BB_CLI=<harness>/bb-instance/bb NODE_ENV=production
# rig/env.local: BB_CHECKOUT=…, BB_MODE=built, ports 39235/39236/39237, BB_SERVER_URL=http://127.0.0.1:39235
<harness>/bb-instance/bbctl start
pnpm exec turbo run build --filter=@get-bb/plugin-sdk   # a path: install imports the SDK at runtime
<harness>/bb-instance/bb plugin install $PWD/plugins/agent-browser --yes
# one projects row + two threads rows in rig/data/bb.db, environment_id NULL
node plugins/agent-browser/measure-isolation.mjs \
  http://127.0.0.1:39235 http://127.0.0.1:39237 <thread-a> <thread-b> \
  data/ws1-backend-plugin/out/isolation-result.json 39239
```

`measure-isolation.mjs` is destructive in its last step by design: it deletes thread A to prove
teardown disposes the session, so a re-run needs fresh synthetic threads.

## Not proven

Stated so the gaps are not discovered later:

- Two concurrent viewers of the *same* thread are covered by a unit test (one context, one
  screencast, stopped only when the last viewer leaves), not by the live run.
- 20s, not hours. Multi-hour sessions, plugin reload mid-stream, and Chrome crash-restart under load
  are untested; the service restarts on a lost Chrome and every session is rebuilt on demand, but
  that path was only exercised by deliberate reloads.
- Loopback only. No reverse proxy or tunnel, each of which has its own buffering and idle timeouts.
- Real sites: local pages only, so no login flow, popup, download, or `window.open` was exercised.
  Navigation policy here is a bounded http/https allowlist; bb's richer
  `isAllowedBrowserUrl`/`resolveWindowOpenAction` policy is the convergence target.
- No frontend. This is the backend half; nothing renders these frames yet.
