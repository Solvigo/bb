---
name: bb-browser
description: Drive visible in-app browser automation inside the bb desktop app with bb browser. Use this whenever you need to QA a page in bb's built-in browser, capture page state, click or type in a controlled tab, or show the operator what you are doing in the UI — including phrases like "open this in the app browser", "snapshot the page", "click the button", or "watch the automation". Do not use dev-browser or external Playwright for bb's in-panel browser; use bb browser instead.
---

# bb browser

Use `bb browser ...` to drive automation-owned browser targets in the bb
desktop app. The operator can watch visible automation and stop it from the
app UI at any time.

## When to use it

- Visible QA, screenshots, and walkthroughs where the user should see what you
  do in bb's in-panel browser.
- Repeatable browser steps from an agent shell without provider-specific
  browser tools.
- Driving only targets your thread owns — not arbitrary user-opened browser
  tabs.

For separate Playwright or Chrome QA outside bb's in-app browser, use
`dev-browser` as a fallback only.

## Context and output

- Prefer `--json` when command output will drive follow-up work.
- Every command needs a thread scope: pass `--thread <id>` or rely on
  `BB_THREAD_ID` in the shell (typical in agent threads).
- Server errors (no desktop channel, auth refusals, missing targets) return
  actionable messages — surface them verbatim to the user instead of guessing.

## Verb set

```bash
bb browser open <url> [--visible] [--thread <id>] [--json]
bb browser list [--thread <id>] [--json]
bb browser navigate <target-id> <url> [--thread <id>] [--json]
bb browser snapshot <target-id> [--thread <id>] [--json]
bb browser click <target-id> (--selector <selector> | --x <n> --y <n>) [--thread <id>] [--json]
bb browser type <target-id> --selector <selector> --text <text> [--thread <id>] [--json]
bb browser eval <target-id> --script-file <path> [--thread <id>] [--json]
bb browser close <target-id> [--thread <id>] [--json]
```

- `open --visible` opens or focuses a visible in-panel tab the operator can watch.
- `list` returns automation targets in the thread scope.
- `snapshot` returns `{ url, title, text }` for the target page (no screenshot
  bytes — visible tabs already show pixels live).
- `navigate` loads a new URL in an existing target instead of opening another.
- `close` releases the automation target when you are done.

## Target ownership

- You drive **your** automation targets in the active thread scope. Targets
  created by another thread or agent are refused.
- Prefer stable `target-id` values from `open` or `list` over implicit "active
  tab" behavior.
- Snapshot after each meaningful action before coordinate clicks so you know
  what changed on the page.
- Prefer `--selector` over `--x`/`--y`. Use coordinates only when selectors are
  impractical and you already have layout from a snapshot.

## Eval scripts

- Keep `--script-file` scripts small, explicit, and justified.
- `eval` runs only in automation-owned targets, not arbitrary user tabs.

## Operator visibility and STOP

- Visible automation is intentional: use `--visible` when the operator should
  watch navigation and interaction.
- The desktop app shows when a tab is under automation and exposes a Stop
  control. If automation stops from the UI, treat that as authoritative and do
  not assume later commands still work until you open or list targets again.

## Related surfaces

- `bb terminal ...` runs shell commands in persistent PTYs when you need
  terminal output instead of browser state.
- `bb settings ...` adjusts server-backed app preferences when browser work
  depends on app configuration.
