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
old links resolve — and a redirect that is _not_ in this list is a finding.

| Route                                | Expected                                      |
| ------------------------------------ | --------------------------------------------- |
| `/`                                  | home                                          |
| `/threads/:threadId`                 | thread view, timeline populated               |
| `/settings`                          | settings index                                |
| `/settings/appearance`               | self                                          |
| `/settings/machines`                 | self                                          |
| `/settings/providers`                | self                                          |
| `/settings/keyboard`                 | self                                          |
| `/settings/updates`                  | self                                          |
| `/settings/experiments`              | self                                          |
| `/settings/usage`                    | self                                          |
| `/settings/files`                    | self                                          |
| `/settings/connections`              | self                                          |
| `/settings/defaults`                 | self                                          |
| `/settings/community`                | self                                          |
| `/settings/archived`                 | self                                          |
| `/tools/skills`                      | self — **the one that broke**                 |
| `/tools/skills/registry`             | self                                          |
| `/tools/plugins`                     | self                                          |
| `/projects/:projectId/settings`      | self                                          |
| `/skills`                            | → `/tools/skills` (legacy)                    |
| `/tools`                             | → `/tools/plugins` (landing)                  |
| `/tools/plugins/browse`              | → `/tools/plugins` (legacy)                   |
| `/archived`                          | → `/settings/archived` (legacy)               |
| `/projects/:projectId/archived`      | → `/settings/archived` (legacy)               |
| `/settings/plugins`                  | → `/tools/plugins` (moved)                    |
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

## Never actuate a control that leaves the browser

**A probe does not click anything that reaches the host machine.** Native folder
and file pickers, OS dialogs, anything the host daemon opens — these appear on
the operator's own screen, not in your headless window, and a click from a probe
puts a modal in front of a person who did not ask for one. It happened: two
Finder choosers were opened on the operator's desktop while verifying a new
button, one of them sitting there for **203 seconds**.

Before driving a surface, inventory its controls and mark the ones that escape.
On this sidebar, "New project from a folder" is one: the host daemon supports a
native picker, so the button calls `host.pick_folder` rather than opening
anything in the page.

Verify those two ways only:

- **read the call path** — follow the handler to whatever it invokes, which is
  what tells you it escapes in the first place; or
- **click it with the operator watching**, having said what will appear.

## The page can tell you the opposite of the truth

The same button produced the inverse of a real result. A DOM probe reported no
dialog, which read exactly like a dead control — the truth was that it had
opened a native chooser the headless browser cannot see. **Absence of evidence
in the DOM is not evidence of absence**, and a verdict of "this does nothing"
needs the call path behind it, never a selector that found nothing.

### Shadow roots: the count that reads zero either way

The file tree renders inside a **custom element with a shadow root**, and a
document-level query cannot see into one. So this:

```js
document.querySelectorAll('[role="treeitem"]').length; // 0 — always
```

returns zero whether the tree is working perfectly or drawing nothing at all.
It cannot distinguish the two states, which is worse than useless: it reads
like evidence. Count through the shadow root instead:

```js
document
  .querySelector("file-tree-container")
  .shadowRoot.querySelectorAll('[role="treeitem"]').length;
```

…or take a screenshot, which sees what a person sees.

The same trap applies to `innerText` on a shadow host: it comes back empty
while the component renders fine.

### Three failures on one surface, none of them the product

This tab was investigated three times before it was understood, and each time
the **measurement** was the broken thing:

- a path truncated inside a probe's own output, sending the reader to a
  different directory that did have files in it;
- a probe matching text in the chat pane rather than in the tree;
- a treeitem count that could not see through a shadow root.

The fix that ended it was not a better probe. It was making the panel **state
what it believes** — loading, error, or ready, plus how many entries it holds —
so one reading replaced an afternoon of inference. When a surface is hard to
verify, that is the thing to add.

## A primary control wired to state nothing renders

Promoting a control changes what its bugs cost. The sidebar built its own copy
of the create-project machinery while the layout rendered the dialog against a
different copy, so opening from the sidebar set state nothing was watching.

That was inert for as long as the button sat inside a drawer nobody opened. As
the primary way to make a project it would have been a **control that looks
alive and does nothing** — the dead Skills link again, wearing different
clothes.

So: when a control is promoted out of a corner, re-verify it end to end rather
than trusting that it worked where it used to live. Check in particular that a
component calling a state hook is the same one rendering what that state drives;
two calls to the same hook are two separate copies.

## Cut a bookkeeping PR from the shared base, never from live

When work lands on a long-lived integration branch first, a PR for one piece of
it must be cut from **the branch it will merge into**, with that piece's commits
cherry-picked. Pointing a new branch at the live tip gives you everything on
live at that moment — including other people's unlanded work — under a title
that describes one change.

It happened here: a PR titled as a one-file documentation change carried six
commits and nine files, and would have landed an entire sidebar restructure.
Nothing about the PR looked wrong; only the diff said so.

So: **read the diff against the base before landing, not the title.** If the two
disagree, the title is the one that is lying.

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
- **a thread with a pending interaction** — the card must _replace_ the
  composer. A plugin-owned card that renders nothing while the composer stays
  is the failure this checklist exists to catch twice: the operator types, the
  server refuses the message, and the screen explains nothing.
- the same pending interaction in an **embedded pane**, not only full-window.
  These are two different rendering paths and one has been wrong before.

## Loading

Watch a cold thread load rather than a warm one. A pane that renders nothing
for several seconds is indistinguishable from a broken pane, and it was
mistaken for one during the investigation that produced this file.

## An empty rig proves nothing

A rig with no registered project cannot exercise a single file surface. Every
thread lands on the Personal project, whose environment is a workspace holding
nothing but dotfiles, so the file tree reads zero — honestly, and looking
exactly like the bug you came to check for.

Give the rig something to look at before judging any of it. `bb project create
--name X --root <path> --host <id>` registers a local path, and a thread whose
`environment.workspace` is `{type: "unmanaged", path: "<checkout>"}` opens onto
that checkout with no clone and no install. Two things that cost an hour each
when guessed at instead:

- **Agent-surface tabs render only on the project-scoped route** —
  `/projects/<id>/threads/<id>`. The unscoped `/threads/<id>` renders the thread
  with no tab strip at all, which reads exactly like a broken tab strip.
- **An unmanaged workspace on a live checkout is for looking.** An agent asked
  to change code there writes to the branch being watched, not to a worktree.

## Two surfaces, one signal

Before adding a count, a badge or a status chip, find out who already shows the
same thing. Two surfaces deriving "the same" number from different signals is
the most expensive shape in this codebase — it is not a rendering bug, nothing
throws, and it is only ever discovered by someone noticing two numbers that
disagree and not knowing which to believe.

The check is cheap: grep for the words the existing surface uses, and read how
it derives them, not just what it prints. `builtInAgentSurfaceTabs.tsx` records
the version of this lesson that cost a whole tab — Clearance was deleted
because "a second place to read the same asks is a second place for them to go
stale".

If a second surface genuinely is wanted, say out loud which signal is
authoritative and make both read it. A count that is right in two places by
coincidence is a count that will be wrong in one of them by Friday.

## Verify the land, not the PR

A change that passed CI and passed a live pass can still reach the rig broken,
because **the regression rides in on the sibling PR**. Two changes landed
together; one had been rendered and confirmed an hour earlier; the other
registered a slot id in the wrong case, and the throw took its plugin's entire
frontend down — tab, panel, banner, all of it — while CI stayed green and the
plugin registry still reported `enabled` with no error.

So the unit of acceptance is the **landed build on the rig**, never the branch
you reviewed. After any refresh:

- **`ff` then RESTART, and prove the order.** `ps -eo lstart` on the server
  against the built artifact's mtime. A server older than its build is serving
  something else, and every measurement taken against it is about the past.
- **Confirm a marker from the change is in the RUNNING bundle**, not just in
  the source tree.
- **Then look at the screen.** The first question is not "does the feature
  work" but "is the surface still there at all". A missing tab reads as a
  design decision; nothing in a log says "the browser tab is gone".

Console warnings are evidence. A plugin can be `enabled`, error-free in the
registry, happily serving its backend, and have no user interface whatsoever —
with one `console.warn` as the only trace in the entire system.

## Navigate for real

Driving routes with `history.pushState` and a synthetic `popstate` produces a
correct URL and, often, no re-render at all — every route then reports the same
content, which reads exactly like "lands on itself but renders the same thing".

That is the probe failing, not the product. Navigate the way the app does — a
real load, or a real click on a real link — before believing any conclusion
about what a route renders.
