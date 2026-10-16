/**
 * Wiring test: bundles the real `src/main.ts`, loads it with a stubbed
 * `obsidian` module and drives it through the events Obsidian would send.
 *
 * This does not replace manual QA inside Obsidian, but it does catch the kind
 * of mistakes that make a plugin fail to load or misbehave on the first click.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { buildSync } from 'esbuild';

const ENTRY = fileURLToPath(new URL('../src/main.ts', import.meta.url));

class FakeFile {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
}

class FakeMarkdownView {
	file: FakeFile | null = null;
	containerEl: unknown = {};
}

class FakeLeaf {
	view: FakeMarkdownView;
	containerEl: unknown = {};
	isDeferred = false;
	state: Record<string, unknown> = {};
	restoreCalls: Array<Record<string, unknown>> = [];

	constructor(view: FakeMarkdownView) {
		this.view = view;
	}

	getEphemeralState(): Record<string, unknown> {
		return this.state;
	}

	setEphemeralState(state: Record<string, unknown>): void {
		this.state = { ...state };
		this.restoreCalls.push(state);
	}

	getViewState(): { type: string; state: { file: string | undefined } } {
		return { type: 'markdown', state: { file: this.view.file?.path } };
	}

	async loadIfDeferred(): Promise<void> {
		this.isDeferred = false;
	}

	async openFile(file: FakeFile, options?: { eState?: Record<string, unknown> }): Promise<void> {
		this.view.file = file;
		this.state = options?.eState ? { ...options.eState } : {};
		this.restoreCalls.push(this.state);
	}
}

interface Command {
	id: string;
	name: string;
	hotkeys?: Array<{ modifiers: string[]; key: string }>;
	repeatable?: boolean;
	callback: () => void;
}

interface Harness {
	plugin: { onload(): void; onunload(): void };
	leaves: FakeLeaf[];
	files: Map<string, FakeFile>;
	commands: Command[];
	setActiveLeafCalls: FakeLeaf[];
	addLeaf(path: string): FakeLeaf;
	/** Put the leaf's cursor / scroll where the user left it. */
	place(leaf: FakeLeaf, line: number): void;
	openNote(leaf: FakeLeaf): void;
	switchTo(leaf: FakeLeaf): void;
	/** Fire the CodeMirror update listener the way a selection change would. */
	editorSelectionChanged(): void;
	run(id: string): void;
	settle(): Promise<void>;
}

function loadPlugin(): Harness {
	const commands: Command[] = [];
	const listeners = new Map<string, Array<(...args: unknown[]) => unknown>>();
	const timers: Array<() => void> = [];
	const leaves: FakeLeaf[] = [];
	const files = new Map<string, FakeFile>();
	const setActiveLeafCalls: FakeLeaf[] = [];
	const editorListeners: Array<(update: unknown) => void> = [];

	class MarkdownView extends FakeMarkdownView {}
	class TFile extends FakeFile {}

	const workspace = {
		activeLeaf: null as FakeLeaf | null,
		on(name: string, callback: (...args: unknown[]) => unknown) {
			const bucket = listeners.get(name) ?? [];
			bucket.push(callback);
			listeners.set(name, bucket);
			return { name };
		},
		onLayoutReady() {
			/* The plugin seeds itself from events in these tests. */
		},
		iterateAllLeaves(callback: (leaf: FakeLeaf) => unknown) {
			for (const leaf of [...leaves]) callback(leaf);
		},
		getLeaf() {
			const leaf = new FakeLeaf(new MarkdownView());
			leaves.push(leaf);
			return leaf;
		},
		setActiveLeaf(leaf: FakeLeaf) {
			setActiveLeafCalls.push(leaf);
			workspace.activeLeaf = leaf;
		},
	};

	const vault = {
		getAbstractFileByPath(path: string) {
			return files.get(path) ?? null;
		},
		on() {
			return { name: 'vault' };
		},
	};

	class Plugin {
		app = { workspace, vault };
		manifest = { id: 'evergreen-navigation' };

		addCommand(command: Command) {
			commands.push(command);
			return command;
		}

		registerEvent(ref: unknown) {
			return ref;
		}

		registerDomEvent() {}

		registerEditorExtension(extension: (update: unknown) => void) {
			editorListeners.push(extension);
		}

		register(callback: () => void) {
			return callback;
		}
	}

	const setTimeoutStub = (callback: () => void) => {
		timers.push(callback);
		return timers.length;
	};
	const clearTimeoutStub = () => undefined;

	const sandbox = {
		module: { exports: {} as Record<string, unknown> },
		exports: {},
		require(id: string) {
			if (id === 'obsidian') return { Plugin, MarkdownView, TFile, WorkspaceLeaf: class {} };
			if (id === '@codemirror/view') {
				return { EditorView: { updateListener: { of: (listener: unknown) => listener } } };
			}
			if (id === '@codemirror/state') return { Transaction: { userEvent: 'userEvent' } };
			throw new Error(`unexpected require(${id})`);
		},
		console,
		document: {},
		window: { setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub },
		setTimeout: setTimeoutStub,
		clearTimeout: clearTimeoutStub,
	};

	const bundle = buildSync({
		entryPoints: [ENTRY],
		bundle: true,
		external: ['obsidian', '@codemirror/view', '@codemirror/state'],
		format: 'cjs',
		platform: 'node',
		target: 'node20',
		write: false,
	}).outputFiles[0].text;

	vm.runInNewContext(bundle, sandbox, { filename: 'main.js' });

	const PluginClass = (
		sandbox.module.exports as { default: new (app: unknown, manifest: unknown) => Harness['plugin'] }
	).default;

	const plugin = new PluginClass({ workspace, vault }, { id: 'evergreen-navigation' });

	return {
		plugin,
		leaves,
		files,
		commands,
		setActiveLeafCalls,

		addLeaf(path: string): FakeLeaf {
			const file = new TFile(path);
			files.set(path, file);
			const leaf = new FakeLeaf(new MarkdownView());
			leaf.view.file = file;
			leaves.push(leaf);
			return leaf;
		},

		place(leaf: FakeLeaf, line: number): void {
			leaf.state = { cursor: { from: { line, ch: 0 }, to: { line, ch: 0 } }, scroll: line };
		},

		openNote(leaf: FakeLeaf): void {
			workspace.activeLeaf = leaf;
			for (const callback of listeners.get('file-open') ?? []) callback(leaf.view.file);
		},

		editorSelectionChanged(): void {
			for (const listener of editorListeners) listener({ selectionSet: true, transactions: [] });
		},

		switchTo(leaf: FakeLeaf): void {
			workspace.activeLeaf = leaf;
			for (const callback of listeners.get('active-leaf-change') ?? []) callback(leaf);
		},

		run(id: string): void {
			const command = commands.find((candidate) => candidate.id === id);
			assert.ok(command, `command ${id} is not registered`);
			command.callback();
		},

		async settle(): Promise<void> {
			for (let i = 0; i < 6; i++) {
				await new Promise((resolve) => setImmediate(resolve));
				while (timers.length > 0) timers.shift()?.();
			}
		},
	};
}

/**
 * Values produced inside the `vm` context have that realm's prototypes, which
 * `deepStrictEqual` rejects. Round-tripping through JSON makes them ordinary
 * objects in this realm.
 */
function plain(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value));
}

/** Close a tab: remove it from the workspace and the vault. */
function closeLeaf(harness: Harness, leaf: FakeLeaf, alsoDeleteFile = false): void {
	harness.leaves.splice(harness.leaves.indexOf(leaf), 1);
	if (alsoDeleteFile && leaf.view.file) harness.files.delete(leaf.view.file.path);
}

describe('plugin wiring', () => {
	it('registers the navigation commands with Mod+[ / Mod+] defaults', () => {
		const harness = loadPlugin();
		harness.plugin.onload();

		const back = harness.commands.find((command) => command.id === 'go-back');
		const forward = harness.commands.find((command) => command.id === 'go-forward');

		assert.ok(back, 'go-back is registered');
		assert.ok(forward, 'go-forward is registered');
		assert.deepEqual(plain(back.hotkeys), [{ modifiers: ['Mod'], key: '[' }]);
		assert.deepEqual(plain(forward.hotkeys), [{ modifiers: ['Mod'], key: ']' }]);
		assert.equal(back.repeatable, true);
		assert.equal(forward.repeatable, true);
	});

	it('walks back and forward across three stacked tabs', async () => {
		const harness = loadPlugin();
		harness.plugin.onload();

		const a = harness.addLeaf('A.md');
		const b = harness.addLeaf('B.md');
		const c = harness.addLeaf('C.md');

		harness.place(a, 10);
		harness.switchTo(a);
		harness.place(b, 20);
		harness.switchTo(b);
		harness.place(c, 30);
		harness.switchTo(c);
		await harness.settle();

		harness.run('go-back');
		await harness.settle();
		assert.equal(harness.setActiveLeafCalls.at(-1), b, 'B keeps focus');
		assert.deepEqual(plain(b.restoreCalls.at(-1)), {
			cursor: { from: { line: 20, ch: 0 }, to: { line: 20, ch: 0 } },
			scroll: 20,
		});

		harness.run('go-back');
		await harness.settle();
		assert.equal(harness.setActiveLeafCalls.at(-1), a);
		assert.deepEqual(plain(a.restoreCalls.at(-1)), {
			cursor: { from: { line: 10, ch: 0 }, to: { line: 10, ch: 0 } },
			scroll: 10,
		});

		harness.run('go-forward');
		await harness.settle();
		assert.equal(harness.setActiveLeafCalls.at(-1), b);

		harness.run('go-forward');
		await harness.settle();
		assert.equal(harness.setActiveLeafCalls.at(-1), c);

		assert.equal(harness.leaves.length, 3, 'no duplicate tabs were created');
	});

	it('reuses the existing tab instead of replacing another tab', async () => {
		const harness = loadPlugin();
		harness.plugin.onload();

		const a = harness.addLeaf('A.md');
		const b = harness.addLeaf('B.md');

		harness.place(a, 5);
		harness.switchTo(a);
		harness.place(b, 60);
		harness.switchTo(b);
		await harness.settle();

		// Navigating back to A must focus A's tab, leaving B showing B.
		harness.run('go-back');
		await harness.settle();

		assert.equal(harness.leaves.length, 2, 'no third tab appeared');
		assert.equal(b.view.file?.path, 'B.md', 'B still shows B');
		assert.equal(a.view.file?.path, 'A.md', 'A still shows A');
		assert.equal(harness.setActiveLeafCalls.at(-1), a);
	});

	it('opens a new tab for a note that is not open anywhere', async () => {
		const harness = loadPlugin();
		harness.plugin.onload();

		const a = harness.addLeaf('A.md');
		const b = harness.addLeaf('B.md');

		harness.place(a, 5);
		harness.switchTo(a);
		harness.place(b, 50);
		harness.switchTo(b);
		await harness.settle();

		closeLeaf(harness, b);
		harness.switchTo(a);

		harness.run('go-back');
		await harness.settle();

		assert.equal(harness.leaves.length, 2, 'a fresh tab was added next to A');
		const created = harness.leaves.at(-1);
		assert.notEqual(created, a, 'the new tab is not A');
		assert.equal(created?.view.file?.path, 'B.md');
		assert.deepEqual(plain(created?.restoreCalls.at(-1)), {
			cursor: { from: { line: 50, ch: 0 }, to: { line: 50, ch: 0 } },
			scroll: 50,
		});
	});

	it('records one stop when a note opens at its remembered position', async () => {
		const harness = loadPlugin();
		harness.plugin.onload();

		const a = harness.addLeaf('A.md');
		harness.place(a, 1);
		harness.switchTo(a);
		await harness.settle();

		// A different note opens in the same leaf. Obsidian raises `file-open`
		// while the editor still sits at the top, and only afterwards applies
		// the remembered cursor (which shows up as a CodeMirror selection change).
		const b = harness.addLeaf('B.md');
		b.state = { cursor: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, scroll: 0 };
		harness.openNote(b);
		b.state = { cursor: { from: { line: 400, ch: 0 }, to: { line: 400, ch: 0 } }, scroll: 400 };
		harness.editorSelectionChanged();
		await harness.settle();

		// One press of back must reach A, not "the top of B".
		harness.run('go-back');
		await harness.settle();
		assert.equal(harness.setActiveLeafCalls.at(-1), a);
	});

	it('does not create history entries for its own back/forward moves', async () => {
		const harness = loadPlugin();
		harness.plugin.onload();

		const a = harness.addLeaf('A.md');
		const b = harness.addLeaf('B.md');
		const c = harness.addLeaf('C.md');

		harness.switchTo(a);
		harness.switchTo(b);
		harness.switchTo(c);
		await harness.settle();

		harness.run('go-back');
		await harness.settle();
		harness.run('go-back');
		await harness.settle();
		harness.run('go-back');
		await harness.settle();

		assert.equal(harness.leaves.length, 3, 'going back never appended a stop');

		harness.run('go-forward');
		await harness.settle();
		assert.equal(harness.setActiveLeafCalls.at(-1), b);

		harness.run('go-forward');
		await harness.settle();
		assert.equal(harness.setActiveLeafCalls.at(-1), c);
	});

	it('skips a note that was deleted while it was in the history', async () => {
		const harness = loadPlugin();
		harness.plugin.onload();

		const a = harness.addLeaf('A.md');
		const b = harness.addLeaf('B.md');
		const c = harness.addLeaf('C.md');

		harness.switchTo(a);
		harness.switchTo(b);
		harness.switchTo(c);
		await harness.settle();

		closeLeaf(harness, b, true);

		harness.run('go-back');
		await harness.settle();

		assert.equal(harness.setActiveLeafCalls.at(-1), a);
	});

	it('applies queued back presses one stop at a time', async () => {
		const harness = loadPlugin();
		harness.plugin.onload();

		const a = harness.addLeaf('A.md');
		const b = harness.addLeaf('B.md');
		const c = harness.addLeaf('C.md');

		harness.switchTo(a);
		harness.switchTo(b);
		harness.switchTo(c);
		await harness.settle();

		harness.run('go-back');
		harness.run('go-back');
		await harness.settle();

		assert.equal(harness.setActiveLeafCalls.at(-2), b);
		assert.equal(harness.setActiveLeafCalls.at(-1), a);
		assert.equal(harness.leaves.length, 3);
	});
});
