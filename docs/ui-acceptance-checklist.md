# UI Acceptance Checklist

The click-through that has to pass before a UI adoption is called done.

It exists because a rig was reported green, and Skills was dead: the route
answered, rendered no error, and quietly showed the home pane. Nothing short of
opening every destination would have caught it — a build that compiles and a
server that answers are not evidence that a page is reachable.

Drive it with your own headless Chrome on its own port and profile. Never the
shared browser.

## How to read a result

A route passes when it **lands on itself**. Two failures hide from a smoke test:

- **Silent redirect** — you asked for `/tools/skills` and the address bar says
  `/`. A gate or a fallthrough sent you home. There is no console error.
- **Rendered but empty** — the route is correct and the pane is blank. Compare
  the body text length against a route known to be populated; under a few
  hundred characters on a page that should have content is the tell.

Record the landed path, not just "it loaded". Zero console exceptions is
necessary and nowhere near sufficient.

## Routes

Every one of these should land on itself unless the Expected column says
otherwise. The redirects listed are deliberate — legacy paths kept routable so
old links resolve — and a redirect that is *not* in this list is a finding.

| Route | Expected |
| --- | --- |
| `/` | home |
| `/threads/:threadId` | thread view, timeline populated |
| `/settings` | settings index |
| `/settings/appearance` | self |
| `/settings/machines` | self |
| `/settings/providers` | self |
| `/settings/keyboard` | self |
| `/settings/updates` | self |
| `/settings/experiments` | self |
| `/settings/usage` | self |
| `/settings/files` | self |
| `/settings/connections` | self |
| `/settings/defaults` | self |
| `/settings/community` | self |
| `/settings/archived` | self |
| `/tools/skills` | self — **the one that broke** |
| `/tools/skills/registry` | self |
| `/tools/plugins` | self |
| `/projects/:projectId/settings` | self |
| `/skills` | → `/tools/skills` (legacy) |
| `/tools` | → `/tools/plugins` (landing) |
| `/tools/plugins/browse` | → `/tools/plugins` (legacy) |
| `/archived` | → `/settings/archived` (legacy) |
| `/projects/:projectId/archived` | → `/settings/archived` (legacy) |
| `/settings/plugins` | → `/tools/plugins` (moved) |
| `/automations`, `/tools/automations` | → `/plugins/automations/automations` (legacy) |

### The experiment gates

`/tools/**` sits behind `ToolsExperimentGate`, which redirects home when
`experiments.toolsHub` is off. That flag is a **per-instance database column**
defaulting to false, so a freshly built rig has Skills switched off while the
instance it was copied from has it on. Check the flag before hunting for a
routing bug:

```
curl -s <server>/api/v1/system/config | python3 -c 'import json,sys;print(json.load(sys.stdin)["experiments"])'
curl -s -X PUT <server>/api/v1/settings/experiments -H 'Content-Type: application/json' \
  -d '{"claudeCodeMockCliTraffic":false,"newOnboarding":false,"toolsHub":true}'
```

The rail advertises Skills whether or not the gate will honour it, so a rig with
the flag off shows a link that goes nowhere.

## The rail

Platform is a curated allowlist and reads exactly **Skills, Connections,
Defaults** — no more. A fourth entry means something auto-mounted, which the
rail contract forbids. Purged plugins that are still installed are the usual
cause, and they survive a plugin refresh because the staging tool only adds and
rebuilds; it never removes.

## Agent surfaces

Open a thread with a live agent and click every tab: **Crew, Brief, Browser**,
plus the panel toggles. Each should change what is rendered. The Browser tab
should show its own chrome — back, forward, reload, Go, DevTools, Annotate.

Then a thread in each state, because the empty and populated cases fail
differently:

- a thread with no messages
- a thread with a running turn
- a thread with a queued message
- **a thread with a pending interaction** — the card must *replace* the
  composer. A plugin-owned card that renders nothing while the composer stays
  is the failure this checklist exists to catch twice: the operator types, the
  server refuses the message, and the screen explains nothing.
- the same pending interaction in an **embedded pane**, not only full-window.
  These are two different rendering paths and one has been wrong before.

## Loading

Watch a cold thread load rather than a warm one. A pane that renders nothing
for several seconds is indistinguishable from a broken pane, and it was
mistaken for one during the investigation that produced this file.
