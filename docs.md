# Evergreen Navigation — internals, testing and limitations

Everything too detailed for the [README](README.md): how it works, what it depends on, what has
been verified, and what has not.

- [Architecture](#architecture)
- [Observation points](#observation-points)
- [Recording rules](#recording-rules)
- [Tab reuse](#tab-reuse)
- [Position restore](#position-restore)
- [Never recording itself](#never-recording-itself)
- [Development](#development)
- [Testing](#testing)
- [Undocumented Obsidian APIs](#undocumented-obsidian-apis)
- [Design notes and the road not taken](#design-notes-and-the-road-not-taken)
- [Manual QA checklist](#manual-qa-checklist)
- [Known limitations](#known-limitations)
- [Secondary feature: hierarchical stacked tabs](#secondary-feature-hierarchical-stacked-tabs)

---

## Architecture

```
src/
├── location.ts               pure: what a "place" is, and how far apart two are
├── history-stack.ts          pure: the browser-style stack (push / replace / back / forward)
├── leaf-registry.ts          pure: which open tab should receive a location
├── editor-jumps.ts           pure: which CodeMirror transactions are deliberate jumps
├── navigation-controller.ts  pure: the queue, the "we are driving" flag, skipping dead files
└── main.ts                   the Obsidian adapter: events in, workspace changes out
```

Only `main.ts` imports `obsidian`. Everything else is plain data in, plain data out, which is
what makes the rules unit-testable with `node --test` and no mocking framework.

A location is:

```ts
{ filePath: string; cursor: { from, to } | null; scrollLine: number | null }
```

`cursor` is present in editing / live preview mode. `scrollLine` is the line at the top of the
viewport — Obsidian reports it as a fractional line number — and is the only position
information available in reading mode.

## Observation points

All five are global; nothing is keyed by tab.

| Signal | Why |
| --- | --- |
| `workspace.on('active-leaf-change')` | switching tabs, including between stacked tabs |
| `workspace.on('file-open')` | opening a different note inside one leaf |
| `EditorView.updateListener` (via `registerEditorExtension`) | cursor and selection changes in any editor |
| `document` `click`, capture phase | a deliberate navigation gesture (link, outline row) |
| `document` `scroll`, capture phase | where you scrolled to; reading-mode heading jumps |

The first two are read **one tick later** than the event fires, coalesced per leaf. Obsidian
raises them *before* it applies a note's remembered cursor, so reading the position in the same
tick records "top of the note" and then a second, spurious stop once the real position lands.
There is a regression test for exactly this (`records one stop when a note opens at its
remembered position`).

## Recording rules

`NavigationHistory.record()` is the single entry point:

| Situation | Result |
| --- | --- |
| Different file | new stop |
| Same file, cursor moved ≥ 10 lines | new stop |
| Same file, cursor moved < 10 lines | current stop refined in place |
| Same file, deliberate jump | new stop, even if 2 lines away |
| Identical | ignored |
| Scroll only | never a stop; the current stop's scroll anchor is updated |

Recording a new stop while `index` is not at the end truncates everything after it — browser
semantics. The stack holds at most 200 stops, dropping the oldest.

In plain words, the four heuristics:

1. **10 lines is "the same place".** Moving less than ten lines in the same note refines the
   current stop instead of adding one. Roughly "still reading the same passage". Same threshold
   as upstream Cursor History.
2. **A gesture beats distance.** If you *clicked* something that navigates — internal link, a
   heading in the outline, a backlink, a search result — that is a new stop even if the target
   is one line away. Detected two ways: a capture-phase DOM click (armed before Obsidian's own
   link handler runs, so the intent is registered first) and CodeMirror's `userEvent`
   annotation. `select.search` is called out explicitly because the `select` prefix would
   otherwise swallow it.
3. **Scrolling is not navigation.** It moves where the current stop points, but never adds a
   stop. So returning to a note puts you back where you left off without the history filling up
   as you read.
4. **Tiny movements are ignored.** Typing, selecting, arrow keys and undo/redo are classified as
   routine. If one side of a comparison has no usable anchor (a view that has not been
   positioned yet), the comparison returns "nearby" rather than inventing a new stop.

## Tab reuse

`openLocation()` never touches the tab you are in. `chooseLeaf()` asks whether any open leaf
already shows the target file:

- **Yes** → `setActiveLeaf(leaf, { focus: true })`, then restore the position. `openFile` is
  never called, so no other tab changes what it displays. Preference order is the active leaf
  first (least disruption), then the first match.
- **No** → `workspace.getLeaf('tab')` adds a tab to the *current tab group* — which is what a
  stacked tab is — and opens the note there.

Background stacked tabs are usually **deferred**: Obsidian has not built their view yet, so
`leaf.view` is a `DeferredView` and `getEphemeralState()` returns `{}`. Two things handle that:

- The file a leaf is showing is read from `leaf.getViewState()`, which returns the *serialized*
  state and therefore works for deferred leaves. (`leaf.view instanceof MarkdownView` is tried
  first, for loaded leaves.)
- `loadIfDeferred()` is awaited before the position is restored.

`leaf.id` is deliberately not used: it is not in the public typings, and path matching is what
the feature actually needs.

## Position restore

Restoring uses Obsidian's own **ephemeral state**, the same mechanism the app uses when you
follow a link or reopen a workspace:

```ts
leaf.setEphemeralState({ cursor: { from, to }, scroll: <line> });
```

`scroll` is a fractional **line number**, not pixels, which is why it survives layout changes.
Reading mode has no cursor, so a reading-mode stop restores scroll only — the same thing
Obsidian itself does.

For a brand-new tab the same state is passed as `eState` to `leaf.openFile()`, and then applied
again via `setEphemeralState()` (idempotent) in case the view was not ready.

## Never recording itself

`NavigationController` owns the history, the queue, and the `navigating` flag:

- Every observation is dropped while `navigating` is set, so back/forward can never append to the
  history.
- Rapid key presses queue up and are applied one at a time, each moving exactly one stop.
- Before moving, the current position is re-recorded (unless a previous step is still settling)
  so that forward returns to where you were.
- After moving, the current entry is re-pointed at the position the workspace *actually* applied
  (`adopt`). Obsidian clamps a restore if the note got shorter, and without this the clamped
  position would look like a brand-new navigation and destroy forward history. There is a test
  for this too.
- Entries whose file no longer exists are skipped in the direction of travel, up to 50, instead
  of aborting the whole navigation.
- `vault.on('rename')` rewrites remembered paths.

## Development

```sh
npm install
npm run typecheck    # tsc --noEmit
npm test             # node --test
npm run build        # production bundle -> main.js
npm run check        # typecheck + test + build
npm run dev          # rebuild main.js on save
npm run dev:vault -- --vault "<vault>"   # rebuild and copy into a vault
```

`main.js` is generated and intentionally **not** committed (see `.gitignore`); it is produced by
`npm run build` and would be attached to a GitHub release.

To see the hidden `.obsidian` folder on macOS, press `Cmd + Shift + .` in Finder, or
`open "<vault>/.obsidian"` from Terminal.

## Testing

53 tests, all in `tests/`, run with Node's built-in test runner and native TypeScript stripping —
no Jest, no Vitest, no mocking library.

- `location.test.mts` — anchors, distance classification, equality.
- `history-stack.test.mts` — push/replace/ignore, forward truncation, the 200 cap, rename
  remapping, adoption, scroll sync.
- `leaf-registry.test.mts` — tab choice, active-leaf preference, non-file views.
- `editor-jumps.test.mts` — which CodeMirror user events count as deliberate jumps.
- `navigation-controller.test.mts` — queueing, rapid presses, ignoring observations during a
  move, skipping deleted files, adoption after a clamped restore.
- `plugin-wiring.test.mts` — bundles the real `main.ts`, loads it against a stubbed `obsidian`
  module in a `vm`, and drives it through the events Obsidian would send: a three-stacked-tab
  walk, tab reuse, the new-tab path, the arrival-ordering regression, the deleted-note path and
  queued presses.

The wiring test does not prove anything about real rendering. It proves the plugin loads and
wires its commands and events correctly, which is where the embarrassing failures live.

## Undocumented Obsidian APIs

Everything is public API except the shape of the markdown ephemeral state, which is passed
through opaquely:

| Use | Status |
| --- | --- |
| `leaf.setEphemeralState({ cursor, scroll })` / `leaf.getEphemeralState()` | public methods, but the `{ cursor, scroll }` shape is not in the typings. Verified against Obsidian **1.14.4** (`app.js`: `MarkdownView.getEphemeralState`, `MarkdownEditView.setState`, `MarkdownPreviewView.setEphemeralState`). |
| `scroll` being a line number rather than a pixel offset | same; verified in 1.14.4. |
| `leaf.getViewState().state.file` for deferred leaves | public method; relies on `state.file` being present for `markdown` views. Verified in 1.14.4. |

Everything else — `active-leaf-change`, `file-open`, `registerEditorExtension`,
`setActiveLeaf`, `getLeaf`, `loadIfDeferred`, `isDeferred`,
`addCommand({ hotkeys, repeatable })`, `Transaction.userEvent` — is public.

If a future Obsidian changes the ephemeral-state shape, the failure mode is graceful:
`readCursor` / `readScrollLine` return `null` and the plugin remembers files without positions.

## Design notes and the road not taken

- **No persistence.** The history is per session. Obsidian already restores each tab's own state
  on restart, and a persisted global history would have to be reconciled against a workspace
  that may have changed completely. Nothing is written to `data.json`.
- **No settings UI.** There is one behaviour and two commands. The only thing worth configuring
  is the hotkey, and Obsidian already has a UI for that.
- **No `markdown-scroll` event.** Obsidian fires an internal `markdown-scroll` event that would
  give the exact view for a scroll. Tidier, but a plain DOM `scroll` listener does the same job
  with only public APIs.
- **Key repeat without a CodeMirror keymap.** Upstream mirrors your hotkeys into a CM6 keymap and
  calls `workspace.updateOptions()` to support key repeat. `repeatable: true` is enough, because
  Obsidian's hotkey manager already replays repeatable commands on key repeat.
- **Default hotkeys, not forced ones.** `addCommand({ hotkeys })` registers *defaults*, so
  Settings → Hotkeys stays in charge and conflicts are reported the normal way.

## Manual QA checklist

Create four notes — `A`, `B`, `C`, `D` — plus one long note for Test B.

**A — global tab history.** Open `A`, `B`, `C` in three separate stacked tabs and end on `C`.
Press `⌘ [` twice, then `⌘ ]` twice.
*Expect:* `B` then `A`, each press focusing the **pre-existing** tab; forward returns to `B`
then `C`; no new tabs appear.

**B — cursor position.** In one long note, click near the top, `Cmd + F` to a match far down,
then click a third, distant section. Press `⌘ [` repeatedly.
*Expect:* the earlier positions in reverse order, cursor **and** scroll restored each time — not
just the file.

**C — existing-tab reuse.** `A` in one tab, `B` in another, `B` active. Press `⌘ [`.
*Expect:* `A`'s tab activates, `B` still shows `B`, no second copy of `A`, and `B` is not
replaced.

**D — closed destination.** Open `A`, then `B`. Close `A`'s tab. With `B` active, press `⌘ [`.
*Expect:* `A` reopens safely in a new tab at the position you left it in.

**E — history branching.** `A` → `B` → `C`, press `⌘ [` twice (now on `A`), then open `D`.
*Expect:* `⌘ ]` does nothing — the forward stops are gone, like a browser. `⌘ [` does nothing
either, since `A` is the oldest stop.

**F — quiet history.** In one note: type a sentence, move the cursor a couple of lines, scroll up
and down, click inside the same paragraph.
*Expect:* `⌘ [` does nothing at all. Then `Cmd + F` to a match a few lines away — `⌘ [` should
return you.

**G — reading mode.** Switch to Reading view, click a heading link to another heading in the same
note (or a heading in the outline pane), then press `⌘ [`.
*Expect:* you return to the earlier scroll position; forward takes you back to the heading.

**H — renamed and deleted notes.** Rename a note that is in the history, then navigate back to
it. *Expect:* it opens under its new name. Then delete a note that is in the history and navigate
back to it. *Expect:* the plugin skips it and lands on the next stop. Check the developer console
(`Cmd + Opt + I`) for exceptions — there should be none.

## Known limitations

- **New tabs accumulate.** Navigating to a note that is not open adds a tab. That is the
  requested behaviour, but a long session can leave a lot of tabs open.
- **No hierarchical stack behaviour yet.** See the next section.
- **Reading mode has no cursor**, so stops made there restore scroll only.
- **Scroll drifts within a stop.** Scrolling updates the current stop, so a stop remembers where
  you last *were* in that note rather than where you first arrived.
- **Popout windows** are treated as ordinary leaves; untested.
- **Mobile** is declared supported (`isDesktopOnly: false`) but untested. Stacked tabs are a
  desktop feature, so the interesting cases only apply on desktop.
- **Renames are handled by path**, so a note renamed while the plugin is disabled shows as
  missing and gets skipped.
- **Only markdown views are tracked.** Canvases, PDFs and other view types are ignored, so
  navigating away from one and back lands on the last markdown note.

## Secondary feature: hierarchical stacked tabs

Wanted: opening A → B → C builds a meaningful chain, and returning to A can close the downstream
tabs B and C instead of leaving every note open. **Not implemented.**

What the investigation found:

- [`zk4/obsidian-evergreen`](https://github.com/zk4/obsidian-evergreen) does this by
  monkey-patching `Workspace.prototype.openLinkText` to force `newLeaf: true`, so every link
  opens a tab and Obsidian's own per-leaf history acts as the chain. ~30 lines, AGPL-3.0 (so its
  code is not reused), and it changes link behaviour for *everything*.
- Doing it well on top of this plugin's model means tracking a parent per stop and, when
  navigating back past a parent, closing the descendants that this plugin opened. The hard parts
  are: closing only tabs we opened and never the user's, deciding what happens when a descendant
  is also reachable from elsewhere in the history, and not fighting Obsidian's own per-leaf
  history.

The plan is a separate, opt-in command (for example *"close descendants of this note"*) rather
than changing default link behaviour.
