# Evergreen Navigation

One global back/forward history for Obsidian — across every note, tab, stacked tab and split
pane — that reuses the tab a note is already open in.

**`Cmd + [`** back · **`Cmd + ]`** forward

## What it does

- **One history for the whole workspace, not one per tab.** Back and forward walk everywhere
  you have been, in the order you went there, no matter which pane or stacked tab you were in.
  Obsidian's built-in Back/Forward is per tab, so a note you opened in another stack is
  invisible to the tab you are sitting in. This adds the missing axis.
- **Reuses tabs instead of duplicating them.** If the note you are going back to is already
  open, that tab is focused and its position restored. It never opens a second copy, and it
  never repurposes another tab's file. If the note is not open anywhere, it opens in a new tab
  in the current stack.
- **Remembers cursor *and* scroll**, in editing, live preview and reading mode.
- **Knows the difference between a jump and a shuffle.** Following an internal link, clicking an
  outline or backlinks row, or jumping to a search result always creates a stop — even two lines
  away. Typing, small cursor moves and scrolling never do. The threshold is 10 lines.
- **Branches like a browser.** Going somewhere new after going back discards the forward stops.
- **Tracks manual stacked-tab switching**, so clicking through a stack of tabs builds history
  the same way following links does.
- **Quiet.** No settings UI, no dependencies, no state written to disk, no changes to your notes
  or vault config. ~860 lines of TypeScript.

## Inspired by

Andy Matuschak's [evergreen notes](https://notes.andymatuschak.org/Evergreen_notes) and the
stacked-notes interface on [his working notes](https://notes.andymatuschak.org/): following a
link pushes a note onto a stack, and you walk back down the stack to leave. He writes about the
model directly in
[Approaches for visualizing navigation and history](https://notes.andymatuschak.org/z78KXXKSNYfwP5QiK4URsC2)
— horizontal navigation for history, vertical navigation for the trail.

Obsidian ships the vertical half of that (stacked tabs) but not the horizontal half. That gap is
the whole reason this plugin exists.

## How it differs from the other plugins

| Plugin | What it is | Where this differs |
| --- | --- | --- |
| [obsidian-cursor-history](https://github.com/AbdelrahmanHafez/obsidian-cursor-history) | The closest relative: one global stack of cursor positions with browser-style back/forward. | It navigates by calling `openFile` on the *active* leaf, so going back replaces whatever the current tab was showing, and an already-open tab for that note is ignored. No scroll restore, no reading-mode positions. This plugin's starting point, and its heuristics are credited below. |
| [obsidian-in-file-nav-history](https://github.com/beaurancourt/obsidian-in-file-nav-history) | Per-pane stacks keyed by leaf id, with careful in-file jump detection and scroll restore. | History is per tab, so it cannot walk a workspace. It is better than this plugin at some in-file cases (it also anchors pre-search positions); the navigation-intent click trick is borrowed from it. |
| [cursor-navigator](https://github.com/MaleleStudySpace/cursor-navigator) | A fork of `remember-cursor-position`: per-note cursor memory plus its own history. Plain JavaScript, no tests. | Not stacked-tab aware, no global ordering across tabs, no tab reuse. |
| [obsidian-evergreen](https://github.com/zk4/obsidian-evergreen) | ~30 lines that monkey-patch `openLinkText` to force every internal link into a new tab, so Obsidian's own per-tab history acts as the chain. AGPL-3.0, so no code is shared. | It is not a history plugin: it changes link behaviour globally, and every link makes a tab. This plugin leaves link behaviour alone. That project is the starting point for the hierarchical-stack idea below. |

## Install

A vault is a folder of notes with a hidden `.obsidian` folder inside it. Plugins live in
`<vault>/.obsidian/plugins/<plugin-id>/`.

1. **Find your vault.** In Obsidian: *Settings → About → Vault path*, or right-click the vault
   name in the vault switcher and pick *Show vault in Finder*. Below, `<vault>` is that path.

2. **Get the files.** Clone somewhere outside your vault and build once:

   ```sh
   git clone https://github.com/Avery2/evergreen-navigation.git
   cd evergreen-navigation
   npm install
   npm run build
   ```

   That produces `main.js`. Together with `manifest.json` those are the only two files needed —
   there is no `styles.css`.

3. **Copy them in.** Easiest is the helper script, which builds and copies in one step and
   refuses to write anywhere that does not look like a vault:

   ```sh
   npm run install:vault -- --vault "<vault>"
   ```

   Add `--dry-run` to see what it would do first. Or do it by hand: press `Cmd + Shift + .` in
   Finder to reveal hidden folders, then create
   `<vault>/.obsidian/plugins/evergreen-navigation/` and copy `main.js` and `manifest.json`
   into it.

4. **Reload and enable.** Run the command *Reload app without saving* (`Cmd + R`), then
   *Settings → Community plugins* → turn off Restricted mode if it is on → enable
   **Evergreen Navigation**.

5. **Check the shortcuts.** *Settings → Hotkeys*, search for `Evergreen Navigation`. `⌘ [` and
   `⌘ ]` are declared as *defaults*, so they usually work already; change them there like any
   other command. Nothing is bound system-wide.

**Updating:** `npm run dev:vault -- --vault "<vault>"` rebuilds and re-copies on every save;
then `Cmd + R` in Obsidian. **Uninstalling:** toggle the plugin off, or delete the
`evergreen-navigation` folder. Nothing is left behind.

## Status

`0.1.0`. 53 automated tests pass and it works in normal use, but it has not been exercised hard
against every combination of stacked tabs, split panes, popouts and reading mode. The full
manual test list, along with known limitations, is in **[docs.md](docs.md)**.

## License

MIT. Derived from
[obsidian-cursor-history](https://github.com/AbdelrahmanHafez/obsidian-cursor-history) (the
global cursor stack, the 10-line threshold, the CodeMirror jump classification) and
[obsidian-in-file-nav-history](https://github.com/beaurancourt/obsidian-in-file-nav-history) (the
navigation-intent click heuristic). Both are MIT and their notices are preserved in
[LICENSE](LICENSE).
