import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { Transaction } from '@codemirror/state';

import { isJumpUserEvent } from './editor-jumps.ts';
import { chooseLeaf, type LeafCandidate } from './leaf-registry.ts';
import { NavigationController, type Navigator } from './navigation-controller.ts';
import type { CursorState, EditorPosition, Location } from './location.ts';

/**
 * Elements whose click means "the user deliberately navigated somewhere".
 *
 * - `a.internal-link` / `.cm-hmd-internal-link` / `.internal-link`: internal
 *   links, in both reading mode and live preview.
 * - `.tree-item-self`: outline, backlinks, tags, search and file-explorer
 *   rows. Clicking one of those is an explicit "take me there" gesture.
 */
const NAV_CLICK_SELECTOR = [
	'a.internal-link',
	'.cm-hmd-internal-link',
	'.internal-link',
	'.tree-item-self',
].join(', ');

/** Scrollers whose movement is worth remembering (editor + reading mode). */
const SCROLL_TARGET_SELECTOR = '.cm-scroller, .markdown-preview-view';

/** After a nav-intent click, movement this long afterwards still counts as a jump. */
const JUMP_INTENT_MS = 600;

/** Coalesce the burst of scroll events produced by one scroll or jump. */
const SCROLL_SETTLE_MS = 100;

/**
 * How long workspace events are ignored after we moved the workspace
 * ourselves, so that our own navigation never lands in the history.
 */
const NAVIGATION_SETTLE_MS = 150;

export default class EvergreenNavigationPlugin extends Plugin {
	private controller!: NavigationController;

	/** Deadline until which observed movement counts as a deliberate jump. */
	private jumpIntentUntil = 0;

	private scrollTimer: number | null = null;
	private scrollLeaf: WorkspaceLeaf | null = null;

	/** Leaves whose position still has to be read, one entry per leaf. */
	private pendingLeaves: WorkspaceLeaf[] = [];
	private observeTimer: number | null = null;

	onload(): void {
		const navigator: Navigator = {
			canOpen: (location) =>
				this.app.vault.getAbstractFileByPath(location.filePath) instanceof TFile,
			open: (location) => this.openLocation(location),
			captureCurrent: () => this.captureActiveLeaf(),
		};

		this.controller = new NavigationController(navigator, {
			settleMs: NAVIGATION_SETTLE_MS,
		});

		this.addCommand({
			id: 'go-back',
			name: 'Navigate back',
			hotkeys: [{ modifiers: ['Mod'], key: '[' }],
			repeatable: true,
			callback: () => this.controller.go('back'),
		});

		this.addCommand({
			id: 'go-forward',
			name: 'Navigate forward',
			hotkeys: [{ modifiers: ['Mod'], key: ']' }],
			repeatable: true,
			callback: () => this.controller.go('forward'),
		});

		// --- observation points ----------------------------------------------

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				this.scheduleObservation(leaf);
			})
		);

		// Fires when the active *file* changes, including within a single leaf.
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (!file) return;
				this.scheduleObservation(this.app.workspace.activeLeaf);
			})
		);

		// Cursor / selection changes inside any editor.
		this.registerEditorExtension(
			EditorView.updateListener.of((update) => this.onEditorUpdate(update))
		);

		// Capture phase: the jump intent must be armed *before* Obsidian's own
		// link handler runs.
		this.registerDomEvent(document, 'click', (event) => this.onDocumentClick(event), true);

		// Scroll events do not bubble, so they need the capture phase too.
		this.registerDomEvent(document, 'scroll', (event) => this.onDocumentScroll(event), true);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => this.controller.history.remapPath(oldPath, file.path))
		);

		this.register(() => {
			if (this.scrollTimer !== null) window.clearTimeout(this.scrollTimer);
			if (this.observeTimer !== null) window.clearTimeout(this.observeTimer);
		});

		this.app.workspace.onLayoutReady(() =>
			this.scheduleObservation(this.app.workspace.activeLeaf)
		);
	}

	// --- recording -----------------------------------------------------------

	/**
	 * Queue a position reading for the next tick.
	 *
	 * Obsidian raises `active-leaf-change` and `file-open` *before* it applies the
	 * note's remembered cursor and scroll. Reading the position in the same tick
	 * would record "top of the note" and then a second, spurious stop once the
	 * real position landed. One tick later the position is the real one.
	 *
	 * Coalesced per leaf, so switching tabs several times in a single tick still
	 * records each tab in order.
	 */
	private scheduleObservation(leaf: WorkspaceLeaf | null): void {
		if (this.controller.isNavigating) return;

		const target = leaf ?? this.app.workspace.activeLeaf;
		if (!target) return;
		if (this.pendingLeaves.includes(target)) return;

		this.pendingLeaves.push(target);
		if (this.observeTimer !== null) return;

		this.observeTimer = window.setTimeout(() => {
			this.observeTimer = null;
			const batch = this.pendingLeaves;
			this.pendingLeaves = [];

			for (const pending of batch) {
				// A stacked tab can still be deferred at the moment it becomes
				// active. Wait for it to materialise before reading its position.
				if (pending.isDeferred) {
					void pending
						.loadIfDeferred()
						.then(() => this.observeLeaf(pending, false))
						.catch(() => undefined);
					continue;
				}
				this.observeLeaf(pending, false);
			}
		}, 0);
	}

	private onEditorUpdate(update: ViewUpdate): void {
		if (this.controller.isNavigating) return;
		if (!update.selectionSet) return;

		const isJump = update.transactions.some((transaction) =>
			isJumpUserEvent(transaction.annotation(Transaction.userEvent))
		);

		this.observeActiveLeaf(isJump);
	}

	private onDocumentClick(event: MouseEvent): void {
		if (this.controller.isNavigating) return;

		const target = event.target;
		if (!(target instanceof Element)) return;
		if (!target.closest(NAV_CLICK_SELECTOR)) return;

		this.jumpIntentUntil = Date.now() + JUMP_INTENT_MS;
	}

	private onDocumentScroll(event: Event): void {
		if (this.controller.isNavigating) return;

		const target = event.target;
		if (!(target instanceof Element)) return;
		if (!target.closest(SCROLL_TARGET_SELECTOR)) return;

		const leaf = this.findLeafForElement(target);
		if (leaf) this.scheduleScrollSettle(leaf);
	}

	private scheduleScrollSettle(leaf: WorkspaceLeaf): void {
		this.scrollLeaf = leaf;
		if (this.scrollTimer !== null) return;

		this.scrollTimer = window.setTimeout(() => {
			this.scrollTimer = null;
			const pending = this.scrollLeaf;
			this.scrollLeaf = null;
			if (pending && !this.controller.isNavigating) this.settleScroll(pending);
		}, SCROLL_SETTLE_MS);
	}

	/**
	 * Scrolling is not navigation, so it never adds a stop. It does refresh the
	 * current stop's scroll anchor, and it is the only signal we get for a
	 * heading-link jump in reading mode.
	 */
	private settleScroll(leaf: WorkspaceLeaf): void {
		const location = this.captureLeaf(leaf);
		if (!location) return;

		// Only a jump that stayed inside one note needs recording here. A jump
		// that changed files was already recorded by the file-open / selection
		// observation, which also consumed the intent.
		const current = this.controller.history.current;
		if (current?.filePath === location.filePath && this.consumeJumpIntent()) {
			this.controller.observe(location, true);
			return;
		}

		this.controller.observeScroll(location.filePath, location.scrollLine);
	}

	private observeActiveLeaf(isJump: boolean): void {
		const leaf = this.app.workspace.activeLeaf;
		if (leaf) this.observeLeaf(leaf, isJump);
	}

	private observeLeaf(leaf: WorkspaceLeaf, isJump: boolean): void {
		if (this.controller.isNavigating) return;

		const location = this.captureLeaf(leaf);
		if (!location) return;

		this.controller.observe(location, isJump || this.consumeJumpIntent());
	}

	private consumeJumpIntent(): boolean {
		if (Date.now() > this.jumpIntentUntil) return false;
		this.jumpIntentUntil = 0;
		return true;
	}

	// --- moving the workspace ------------------------------------------------

	/**
	 * Move to a remembered location.
	 *
	 * If the note is already open somewhere, that tab is activated and nothing
	 * else changes. Otherwise a tab is added to the current tab group (which is
	 * what a stacked tab is). The active tab is never repurposed, so it keeps
	 * showing whatever it showed before.
	 */
	private async openLocation(entry: Location): Promise<void> {
		const leaf = this.resolveLeaf(entry.filePath);

		if (leaf) {
			if (leaf.isDeferred) await leaf.loadIfDeferred();
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
			this.restorePosition(leaf, entry);
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(entry.filePath);
		if (!(file instanceof TFile)) return;

		const fresh = this.app.workspace.getLeaf('tab');
		await fresh.openFile(file, { eState: ephemeralState(entry), active: true });
		this.restorePosition(fresh, entry);
	}

	/** The leaf already showing `filePath`, or `null` if none does. */
	private resolveLeaf(filePath: string): WorkspaceLeaf | null {
		const active = this.app.workspace.activeLeaf;
		const candidates: LeafCandidate<WorkspaceLeaf>[] = [];

		this.app.workspace.iterateAllLeaves((leaf) => {
			candidates.push({
				leaf,
				filePath: leafFilePath(leaf),
				isActive: leaf === active,
			});
		});

		return chooseLeaf(candidates, filePath);
	}

	/**
	 * Restore cursor and scroll using Obsidian's own ephemeral state, which is
	 * the same mechanism the app uses when you follow a link or reopen a
	 * workspace. It works in editing, live-preview and reading mode.
	 */
	private restorePosition(leaf: WorkspaceLeaf, entry: Location): void {
		const state = ephemeralState(entry);
		if (Object.keys(state).length === 0) return;

		try {
			leaf.setEphemeralState(state);
		} catch (error) {
			console.warn('[evergreen-navigation] could not restore position', error);
		}
	}

	// --- capture -------------------------------------------------------------

	private captureActiveLeaf(): Location | null {
		const leaf = this.app.workspace.activeLeaf;
		return leaf ? this.captureLeaf(leaf) : null;
	}

	private captureLeaf(leaf: WorkspaceLeaf): Location | null {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return null;

		const file = view.file;
		if (!file) return null;

		let state: Record<string, unknown> = {};
		try {
			state = (leaf.getEphemeralState() as Record<string, unknown> | null) ?? {};
		} catch {
			state = {};
		}

		return {
			filePath: file.path,
			cursor: readCursor(state.cursor),
			scrollLine: readScrollLine(state.scroll),
		};
	}

	private findLeafForElement(element: Element): WorkspaceLeaf | null {
		let found: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found) return;
			const container = leaf.view?.containerEl;
			if (container && container.contains(element)) found = leaf;
		});

		return found;
	}
}

// --- Obsidian <-> plain data helpers ---------------------------------------

/**
 * The file a leaf is showing, without forcing a deferred view to load.
 *
 * `leaf.getViewState()` returns the *serialized* state, which Obsidian keeps
 * for deferred (background stacked) tabs, so this works for tabs that have not
 * been rendered yet.
 */
function leafFilePath(leaf: WorkspaceLeaf): string | null {
	const view = leaf.view;
	if (view instanceof MarkdownView) return view.file?.path ?? null;

	try {
		const state = leaf.getViewState();
		if (state.type !== 'markdown') return null;
		const file = state.state?.file;
		return typeof file === 'string' ? file : null;
	} catch {
		return null;
	}
}

/** Build the `eState` Obsidian itself uses to remember a markdown position. */
function ephemeralState(entry: Location): Record<string, unknown> {
	const state: Record<string, unknown> = {};
	if (entry.cursor) state.cursor = entry.cursor;
	if (entry.scrollLine !== null) state.scroll = entry.scrollLine;
	return state;
}

function readCursor(value: unknown): CursorState | null {
	if (!value || typeof value !== 'object') return null;

	const candidate = value as { from?: unknown; to?: unknown };
	const from = readPosition(candidate.from);
	const to = readPosition(candidate.to);
	if (!from || !to) return null;

	return { from, to };
}

function readPosition(value: unknown): EditorPosition | null {
	if (!value || typeof value !== 'object') return null;

	const { line, ch } = value as { line?: unknown; ch?: unknown };
	if (typeof line !== 'number' || !Number.isFinite(line)) return null;
	if (typeof ch !== 'number' || !Number.isFinite(ch)) return null;

	return { line: Math.max(0, Math.trunc(line)), ch: Math.max(0, Math.trunc(ch)) };
}

function readScrollLine(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
	return Math.round(value);
}
