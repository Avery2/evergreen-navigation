# Evergreen Navigation

A local Obsidian plugin that gives your vault **one global back/forward history** across every
note, tab, stacked tab and split pane — and that reuses the tab a note is already open in
instead of opening duplicates or replacing what another tab is showing.

- **One history, not one per tab.** Back and forward walk through everywhere you have been,
  regardless of which pane or stacked tab you were in.
- **Position-aware.** A stop remembers the cursor and the scroll position, including several
  distinct positions inside the same long note.
- **Tab-reusing.** Navigating to a note that is already open focuses that tab and restores its
  position. It never opens a second copy, and it never repurposes another tab.
- **Opt-in shortcuts.** `Cmd + [` and `Cmd + ]` on macOS, declared as *default* hotkeys so you
  can rebind them in Settings → Hotkeys like any other Obsidian command.
- **Small.** ~860 lines of TypeScript across six files, no runtime dependencies, no settings
  UI, no writes to your notes or vault configuration.

> **Status:** first version, built and unit tested, but **not yet verified by hand inside
> Obsidian**. See [Manual QA checklist](#manual-qa-checklist). Please run those tests before
> trusting it.

---

## Installation

You install an Obsidian plugin by putting its built files into a folder inside your vault.
The folder must be named after the plugin id: `evergreen-navigation`.

### 1. Find your vault directory

A *vault* is just a folder of notes with a hidden `.obsidian` folder inside it.

In Obsidian: **Settings → About → Vault path** (or right-click the vault name in the vault
switcher and choose *Show vault in Finder*). Write that path down — the steps below call it
`<vault>`.

### 2. See the hidden `.obsidian` folder (macOS)

`.obsidian` starts with a dot, so Finder hides it.

- In Finder, press **`Cmd + Shift + .`** (period) to toggle hidden files on and off.
- Or jump straight there from Terminal:

  ```sh
  open "<your vault>/.obsidian"
  ```

  If that fails, the folder may not exist yet — create the `plugins` folder inside it in the
  next step.

### 3. Get the built plugin files

Clone the repository somewhere outside your vault (anywhere you like — it does not have to be
near the vault):

```sh
git clone https://github.com/Avery2/evergreen-navigation.git
cd evergreen-navigation
```

Build it once:

```sh
npm install     # only needed the first time
npm run build
```

This produces **`main.js`** next to `manifest.json`. Those are the only two files a plugin
needs; this plugin has no `styles.css`.

### 4. Copy the files in

Create the folder `<vault>/.obsidian/plugins/evergreen-navigation/` and copy `main.js` and
`manifest.json` into it. The result must look exactly like this:

```
<vault>/.obsidian/plugins/evergreen-navigation/
├── main.js
└── manifest.json
```

Two ways to do it:

**Option A — the helper script (recommended).** It builds and copies in one step, and refuses
to write anywhere that does not look like a vault:

```sh
cd evergreen-navigation
npm run install:vault -- --vault "<vault>"
```

Add `--dry-run` first if you want to see what it would do. Nothing is ever written to a vault
unless you pass `--vault` explicitly.

**Option B — manual.** After `npm run build`, copy `main.js` and `manifest.json` into the
folder yourself in Finder (with hidden files visible).

### 5. Reload Obsidian and enable the plugin

1. In Obsidian, run the command **“Reload app without saving”** (`Cmd + R` works too), or just
   quit and reopen Obsidian.
2. Go to **Settings → Community plugins**.
3. If *Restricted mode* is on, turn it off (this is what allows any local plugin to run).
4. **Evergreen Navigation** now appears in the *Installed plugins* list. Turn it **on**.

If it does not appear, the folder name or file names are wrong — re-check step 4.

### 6. Assign the keyboard shortcuts

The plugin declares `Cmd + [` and `Cmd + ]` as **default** hotkeys, so they usually just work
after step 5. To check or change them:

1. **Settings → Hotkeys**.
2. Search for `Evergreen Navigation`.
3. You should see:
   - **Evergreen Navigation: Navigate back** → `⌘ [`
   - **Evergreen Navigation: Navigate forward** → `⌘ ]`
4. Click the `+` next to either one to add a different binding, or the `×` to remove the
   default. (If Obsidian shows a warning that the shortcut is already used, the `×` next to the
   conflict tells you which command currently owns it.)

Nothing is bound system-wide: these are ordinary Obsidian hotkeys and only fire while Obsidian
has focus.

> Obsidian also has its own built-in **Back**/**Forward** (`app:go-back`, default
> `⌘ ⌥ ←`). Those are per-tab and unrelated. The two can coexist; if you prefer, unbind the
> built-in ones in Settings → Hotkeys.

### 7. Updating after a code change

You do **not** have to copy files by hand every time. From the repository:

```sh
npm run dev:vault -- --vault "<your vault>"
```

This rebuilds `main.js` on every save and copies it into the plugin folder. After each rebuild,
reload the plugin in Obsidian with the **“Reload app without saving”** command (`Cmd + R`).

`npm run dev` (without `--vault`) just rebuilds on save without touching any vault.

### 8. Disabling or uninstalling

- **Disable:** Settings → Community plugins → toggle *Evergreen Navigation* off. The plugin
  keeps no state on disk, so nothing is left behind.
- **Uninstall:** click the trash icon next to the plugin, or delete the
  `<vault>/.obsidian/plugins/evergreen-navigation/` folder.
- Nothing the plugin does modifies your notes, your other plugins, or Obsidian's settings.

---

## Usage

| Action | Command | Default (macOS) |
| --- | --- | --- |
| Go to the previous place | `Evergreen Navigation: Navigate back` | `⌘ [` |
| Go to the next place | `Evergreen Navigation: Navigate forward` | `⌘ ]` |

Hold the shortcut to keep moving (the commands are marked *repeatable*, so Obsidian replays
them on key repeat).

What counts as “a place”:

- Opening a note (any tab, stacked tab or split).
- Switching to a different stacked tab that shows a different note.
- A deliberate jump inside one note: following an internal link or heading link, clicking an
  outline/backlinks row, jumping to a search result, or a large cursor movement.
- Where you scrolled to in the note you are leaving.

What does **not** create a stop: typing, small cursor movements, nearby clicks, plain scrolling,
and back/forward navigation itself.

---

## How it works

```
src/
├── location.ts              pure: what a "place" is, and how far apart two are
├── history-stack.ts         pure: the browser-style stack (push / replace / back / forward)
├── leaf-registry.ts         pure: which open tab should receive a location
├── editor-jumps.ts          pure: which CodeMirror transactions are deliberate jumps
├── navigation-controller.ts pure: the queue, the "we are driving" flag, skipping dead files
└── main.ts                  the Obsidian adapter: events in, workspace changes out
```

Only `main.ts` imports `obsidian`. Everything else is plain data in and plain data out, which is
what makes the rules unit-testable with `node --test` and no mocking framework.

### Global history

`NavigationHistory` holds a list of `Location`s and an index. `Location` is:

```ts
{ filePath: string; cursor: { from, to } | null; scrollLine: number | null }
```

`main.ts` feeds it from five observation points, all of which are global (nothing is keyed by
tab):

| Signal | Why |
| --- | --- |
| `workspace.on('active-leaf-change')` | switching tabs, including between stacked tabs |
| `workspace.on('file-open')` | opening a different note inside one leaf |
| `EditorView.updateListener` | cursor/selection changes in any editor |
| `document` `click` (capture) | a deliberate navigation gesture (link, outline row) |
| `document` `scroll` (capture) | where you scrolled to; reading-mode heading jumps |

The first two are read one tick later than the event, because Obsidian raises them *before* it
applies a note's remembered cursor — reading in the same tick would record "top of the note" and
then a second, spurious stop once the real position landed. (There is a regression test for
exactly this: *records one stop when a note opens at its remembered position*.)

Every observation is turned into a `record()` call:

- **Different file** → new stop.
- **Same file, cursor moved ≥ 10 lines** → new stop.
- **Same file, cursor moved < 10 lines** → the current stop is *refined* in place, so walking
  around one passage does not fill the history with noise.
- **Same file, a deliberate jump** (link, outline, search result) → new stop even if it is only
  two lines away.
- **Identical** → ignored.
- Scrolling alone never creates a stop; it only updates the scroll anchor of the current one.

Recording a new stop after going back discards the forward stops, exactly like a browser.

### Tab reuse

`openLocation()` never touches the tab you are in. It asks `chooseLeaf()` whether any open leaf
already shows the target file:

- **Yes** → `setActiveLeaf(leaf, { focus: true })`, then restore the position. That brings the
  right stacked tab to the front. `openFile` is never called, so no other tab changes what it
  displays.
- **No** → `workspace.getLeaf('tab')` adds a tab to the *current tab group* (which is what a
  stacked tab is) and opens the note there.

Background stacked tabs are often *deferred* (Obsidian has not built their view yet). The
plugin handles that by asking `leaf.getViewState()` — which is available even for a deferred
leaf — for the file it is showing, and by calling `loadIfDeferred()` before restoring.

### Restoring cursor and scroll

Restoring uses Obsidian's own **ephemeral state**, the same mechanism the app uses when you
follow a link or reopen a workspace:

```ts
leaf.setEphemeralState({ cursor: { from, to }, scroll: <line> });
```

`scroll` is a (fractional) **line number**, not pixels — Obsidian reports it that way, which is
why it survives layout changes. Reading mode has no cursor, so a reading-mode stop restores the
scroll position only. That is the same thing Obsidian itself does.

### Not recording our own navigation

`NavigationController` sets a `navigating` flag for the duration of a move and ignores every
observation while it is set, so back/forward can never append to the history. It also:

- queues rapid key presses so each one moves exactly one stop;
- re-points the current entry at where the workspace *actually* ended up (`adopt`), so an
  Obsidian-clamped restore cannot look like a brand-new navigation;
- skips entries whose file no longer exists, in the direction of travel, instead of aborting;
- rewrites remembered paths when the vault reports a rename or move.

### Cursor-history heuristics, in plain words

1. **10 lines is “the same place”.** Moving less than ten lines in the same note refines the
   current stop instead of creating a new one. Ten lines is roughly “still reading the same
   passage”. It is the same threshold the upstream Cursor History plugin uses.
2. **A gesture beats distance.** If you *clicked* something that navigates — an internal link,
   a heading in the outline, a backlink, a search result — that is a new stop even if the
   target is one line away. This is detected from the DOM click (capture phase, so it is
   recorded before Obsidian's own handler runs) and from CodeMirror's `userEvent` annotation.
3. **Scrolling is not navigation.** It updates where the current stop points, but never adds a
   stop. So returning to a note puts you back at the scroll position you left, without the
   history filling up as you read.
4. **Nothing is recorded for tiny movements.** Typing, selecting, arrow keys and undo/redo are
   classified as routine and never create stops.

---

## Development

```sh
npm install
npm run typecheck    # tsc --noEmit
npm test             # node --test (unit + wiring tests)
npm run build        # typecheck-free production bundle -> main.js
npm run check        # typecheck + test + build
npm run dev          # rebuild main.js on save
npm run dev:vault -- --vault "<vault>"   # rebuild and copy into a vault
```

The test suite covers the pure modules plus a **wiring test** that bundles the real `main.ts`,
loads it against a stubbed `obsidian` module in a `vm`, and drives it through the events
Obsidian would send — including the three-stacked-tab walk, tab reuse, the new-tab path, and
skipping a deleted note. It does not, and cannot, prove anything about real rendering.

`main.js` is generated and intentionally **not** committed (see `.gitignore`); it is produced by
`npm run build` and would be attached to a GitHub release.

### Undocumented Obsidian APIs

Everything the plugin uses is in the public `obsidian.d.ts` **except** the shape of the
markdown ephemeral state, which is passed through opaquely:

| Use | Status |
| --- | --- |
| `leaf.setEphemeralState({ cursor, scroll })` / `leaf.getEphemeralState()` | public method, but the `{ cursor, scroll }` shape is not in the typings. Verified against Obsidian **1.14.4** (`app.js`: `MarkdownView.getEphemeralState`, `MarkdownEditView.setState`, `MarkdownPreviewView.setEphemeralState`). |
| `scroll` being a line number rather than a pixel offset | same as above; verified in 1.14.4. |
| `leaf.getViewState().state.file` for deferred leaves | public method; relying on `state.file` being present for `markdown` views. Verified in 1.14.4. |

Everything else — `active-leaf-change`, `file-open`, `registerEditorExtension`,
`setActiveLeaf`, `getLeaf`, `loadIfDeferred`, `isDeferred`,
`addCommand({ hotkeys, repeatable })`, `Transaction.userEvent` — is public API.

If a future Obsidian release changes the ephemeral-state shape, the failure mode is graceful:
`readCursor` / `readScrollLine` return `null` and the plugin falls back to remembering files
without positions.

### Design notes and the road not taken

- **No persistence.** The history is per session. Obsidian already restores each tab's own
  state on restart, and a persisted global history would have to be reconciled against a
  workspace that may have changed completely. Nothing is written to `data.json`.
- **No settings UI.** There is one behaviour and two commands; the only thing worth
  configuring is the hotkey, and Obsidian already has a UI for that.
- **No `markdown-scroll` event.** Obsidian fires an internal `markdown-scroll` event that would
  give the exact view for a scroll. Using it would have been tidier, but a plain DOM `scroll`
  listener does the same job with only public APIs.
- **Key repeat without a CodeMirror keymap.** The upstream Cursor History plugin mirrors your
  hotkeys into a CM6 keymap and calls `workspace.updateOptions()` to support key repeat. This
  plugin just sets `repeatable: true`, which Obsidian's hotkey manager already honours.

---

## Manual QA checklist

Please run these inside Obsidian and report pass/fail. Create four notes for the test —
`A`, `B`, `C`, `D` — and one long note for Test B.

**Test A — global tab history**
Open `A`, `B` and `C` in three separate stacked tabs (switch *Stacked tabs* on, or use
“Open in new tab” three times). Click into each so `C` is active. Press `⌘ [` twice, then
`⌘ ]` twice.
*Expected:* you land on `B` then `A`, and each press focuses the **pre-existing** tab for that
note — no new tabs appear. Forward returns to `B` then `C`.

**Test B — cursor position**
In one long note, click near the top, then `Cmd + F` and jump to a match far down the file, then
click in a third, distant section. Press `⌘ [` repeatedly.
*Expected:* each press moves you back to the earlier positions in reverse order, with the
cursor and the scroll position both restored — not just the file.

**Test C — existing-tab reuse**
Open `A` in one tab and `B` in another, with `B` active. Press `⌘ [`.
*Expected:* `A`'s tab becomes active and `B` is still showing `B` in its own tab. There is no
second copy of `A`, and `B` has not been replaced.

**Test D — closed destination**
Open `A`, then `B`. Close `A`'s tab. With `B` active, press `⌘ [`.
*Expected:* `A` reopens safely in a new tab, at the position you left it in.

**Test E — history branching**
Open `A`, then `B`, then `C`. Press `⌘ [` twice (so you are on `A`). Now open `D`.
*Expected:* pressing `⌘ ]` does nothing — the forward history to `B` and `C` is gone, exactly
like a browser. `⌘ [` should do nothing either, since `A` is the oldest stop.

**Test F — quiet history**
Open one note and type a sentence, move the cursor a couple of lines, scroll up and down, and
click within the same paragraph.
*Expected:* `⌘ [` does nothing at all — none of that created a stop. Then press `Cmd + F` and
jump to a match a few lines away, and `⌘ [` should return you to where you were.

**Test G — reading mode**
Switch a note to Reading view, click a heading link to another heading in the same note (or a
heading in the outline pane), then press `⌘ [`.
*Expected:* you return to the earlier scroll position. Forward takes you back to the heading.

**Test H — renamed and deleted notes**
Rename a note in the history (via the file explorer), then navigate back to it.
*Expected:* it opens under its new name. Then delete a note that is in the history and navigate
back to it.
*Expected:* the plugin skips it and lands on the next stop instead of erroring. Check the
developer console (`Cmd + Opt + I`) for exceptions — there should be none.

---

## Known limitations

- **Not verified by hand.** Everything above is from reading the Obsidian 1.14.4 bundle, the
  public typings, and automated tests. Real-window behaviour (stacked tabs, reading mode,
  popouts) is unverified. See the checklist.
- **New tabs accumulate.** Navigating to a note that is not open adds a tab. That is what was
  asked for, but over a long session it can leave a lot of tabs open.
- **No hierarchical stack behaviour yet.** The “opening A → B → C, and returning to A closes B
  and C” feature is *not* implemented. See below.
- **Reading mode has no cursor.** Stops made in Reading view restore the scroll position only.
- **Scroll position drifts within a stop.** Scrolling updates the current stop, so a stop
  remembers where you last *were* in that note rather than where you first arrived.
- **Popout windows** are treated as ordinary leaves; untested.
- **Mobile** is declared supported (`isDesktopOnly: false`) but untested. Stacked tabs are a
  desktop feature, so the interesting cases only apply on desktop.
- **Renames are handled by path**, so a note renamed while the plugin is disabled will show as
  missing and be skipped.

### Secondary feature: hierarchical stacked tabs

Investigated, deliberately deferred. Notes:

- [`zk4/obsidian-evergreen`](https://github.com/zk4/obsidian-evergreen) does this by
  monkey-patching `Workspace.prototype.openLinkText` to force `newLeaf: true`, so that every
  link opens a new tab and Obsidian's own per-leaf history can act as the chain. It is ~30 lines
  and is **AGPL-3.0**, so its code is not reused here. It also makes *every* link open a new tab,
  which is a big behavioural change.
- Doing it well on top of this plugin's model means tracking a *parent* per stop and, on
  navigating back past a parent, closing the descendants that this plugin opened. The tricky
  parts are: only closing tabs we opened (never the user's), deciding what happens when a
  descendant is also reachable from elsewhere in the history, and not fighting Obsidian's own
  per-leaf history.

The plan is to add it later as a separate, opt-in command (e.g. *“Close descendants of this
note”*) rather than changing the default link behaviour.

---

## License and attribution

MIT. This plugin is derived from two MIT-licensed projects and their notices are preserved in
[`LICENSE`](./LICENSE):

- [`AbdelrahmanHafez/obsidian-cursor-history`](https://github.com/AbdelrahmanHafez/obsidian-cursor-history)
  — the global cursor stack, the back/forward model, the 10-line threshold, and the CodeMirror
  jump classification.
- [`beaurancourt/obsidian-in-file-nav-history`](https://github.com/beaurancourt/obsidian-in-file-nav-history)
  — the navigation-intent click heuristic for same-file jumps in reading mode.

Also investigated, not reused:
[`MaleleStudySpace/cursor-navigator`](https://github.com/MaleleStudySpace/cursor-navigator)
(MIT; a fork of `remember-cursor-position` — per-note cursor memory plus a history, plain
JavaScript) and [`zk4/obsidian-evergreen`](https://github.com/zk4/obsidian-evergreen) (AGPL-3.0,
see above).
