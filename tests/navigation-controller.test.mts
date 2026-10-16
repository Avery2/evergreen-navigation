import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NavigationController, type Navigator } from '../src/navigation-controller.ts';
import type { Location } from '../src/location.ts';
import { at, summary } from './helpers.mts';

/** A stand-in for the Obsidian workspace. */
class FakeWorkspace implements Navigator {
	readonly files = new Set<string>();
	readonly opened: string[] = [];
	/** Positions the app refuses to honour exactly (e.g. the note got shorter). */
	readonly clamps = new Map<string, number>();
	/** Called while the controller is moving, to simulate stray events. */
	onOpen: (() => void) | null = null;

	current: Location | null = null;

	add(...paths: string[]): this {
		for (const path of paths) this.files.add(path);
		return this;
	}

	canOpen(location: Location): boolean {
		return this.files.has(location.filePath);
	}

	async open(location: Location): Promise<void> {
		this.opened.push(location.filePath);
		this.onOpen?.();
		const clamped = this.clamps.get(location.filePath);
		this.current = clamped === undefined ? location : at(location.filePath, clamped);
	}

	captureCurrent(): Location | null {
		return this.current;
	}
}

/** Collects the controller's settle timers so tests can control them. */
function createScheduler() {
	const pending: Array<() => void> = [];
	return {
		schedule: (callback: () => void) => void pending.push(callback),
		flush() {
			while (pending.length > 0) pending.shift()?.();
		},
	};
}

async function setup(...paths: string[]) {
	const workspace = new FakeWorkspace().add(...paths);
	const scheduler = createScheduler();
	const controller = new NavigationController(workspace, { schedule: scheduler.schedule });

	for (const path of paths) {
		controller.observe(at(path, 1));
	}

	return { controller, scheduler, workspace };
}

describe('NavigationController back / forward', () => {
	it('reuses the remembered location and does not add stops', async () => {
		const { controller, scheduler, workspace } = await setup('a.md', 'b.md', 'c.md');
		scheduler.flush();

		controller.go('back');
		await controller.settled();
		scheduler.flush();

		assert.equal(workspace.current?.filePath, 'b.md');
		assert.equal(controller.history.size, 3);
		assert.equal(controller.history.canGoForward, true);

		controller.go('forward');
		await controller.settled();
		scheduler.flush();

		assert.equal(workspace.current?.filePath, 'c.md');
		assert.equal(controller.history.size, 3);
	});

	it('applies rapid presses one stop at a time', async () => {
		const { controller, scheduler, workspace } = await setup('a.md', 'b.md', 'c.md');
		scheduler.flush();

		controller.go('back');
		controller.go('back');
		controller.go('back');
		await controller.settled();
		scheduler.flush();

		assert.deepEqual(workspace.opened, ['b.md', 'a.md']);
		assert.equal(workspace.current?.filePath, 'a.md');
		assert.equal(controller.history.size, 3);

		controller.go('forward');
		await controller.settled();
		scheduler.flush();

		assert.equal(workspace.current?.filePath, 'b.md');
	});

	it('discards forward history when a new location is visited', async () => {
		const { controller, scheduler } = await setup('a.md', 'b.md', 'c.md');
		scheduler.flush();

		controller.go('back');
		controller.go('back');
		await controller.settled();
		scheduler.flush();
		assert.equal(controller.history.current?.filePath, 'a.md');

		controller.observe(at('d.md', 1));

		assert.deepEqual(summary(controller.history.all), ['a.md:1', 'd.md:1']);
		assert.equal(controller.history.canGoForward, false);
	});

	it('ignores observations raised while it is moving the workspace', async () => {
		const { controller, scheduler, workspace } = await setup('a.md', 'b.md', 'c.md');
		scheduler.flush();

		// A file-open event fired by our own move, before the settle window ends.
		workspace.onOpen = () => controller.observe(at('b.md', 1));

		controller.go('back');
		await controller.settled();

		assert.equal(controller.history.size, 3);
		assert.equal(controller.history.canGoForward, true);

		scheduler.flush();
	});

	it('skips entries whose file no longer exists', async () => {
		const { controller, scheduler, workspace } = await setup('a.md', 'b.md', 'c.md');
		scheduler.flush();

		workspace.files.delete('b.md');

		controller.go('back');
		await controller.settled();
		scheduler.flush();

		assert.deepEqual(workspace.opened, ['a.md']);
		assert.equal(workspace.current?.filePath, 'a.md');
	});

	it('adopts the position the workspace actually applied', async () => {
		const { controller, scheduler, workspace } = await setup('a.md', 'b.md', 'c.md');
		scheduler.flush();

		// The note shrank, so line 1 is no longer reachable and Obsidian clamps
		// the restore to line 99.
		workspace.clamps.set('b.md', 99);

		controller.go('back');
		await controller.settled();
		scheduler.flush();

		assert.equal(controller.history.current?.cursor?.from.line, 99);

		// A later stray event must not look like a brand new navigation.
		controller.observe(at('b.md', 99));
		assert.equal(controller.history.size, 3);
		assert.equal(controller.history.canGoForward, true);
	});

	it('does nothing when there is nowhere to go', async () => {
		const { controller, scheduler, workspace } = await setup('a.md');
		scheduler.flush();

		controller.go('back');
		controller.go('forward');
		await controller.settled();
		scheduler.flush();

		assert.deepEqual(workspace.opened, []);
		assert.equal(controller.history.size, 1);
	});
});
