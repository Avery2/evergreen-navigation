import { NavigationHistory } from './history-stack.ts';
import type { Location } from './location.ts';

export type Direction = 'back' | 'forward';

/**
 * The workspace, as seen by the controller. Implemented by `main.ts` against
 * Obsidian and by the tests against a fake, which keeps all of the interesting
 * sequencing logic unit testable.
 */
export interface Navigator {
	/** Can this location still be shown (does the file exist)? */
	canOpen(location: Location): boolean;
	/** Move the workspace to this location. */
	open(location: Location): Promise<void>;
	/** Where the workspace is right now, or `null` when nothing suitable is open. */
	captureCurrent(): Location | null;
}

export interface NavigationControllerOptions {
	/** How long the workspace is given to settle after a move, in ms. */
	settleMs?: number;
	/** Injectable timer, so tests do not need to wait. */
	schedule?: (callback: () => void, delayMs: number) => void;
}

/** Safety bound when skipping entries whose file is gone. */
const MAX_SKIP = 50;

/**
 * Owns the history, the back/forward queue and the "we are driving the
 * workspace" flag.
 *
 * Sequencing rules encoded here:
 * - Observations are ignored while we are moving the workspace, so back and
 *   forward can never record themselves as new stops.
 * - Rapid key presses queue up and are applied one at a time, each moving
 *   exactly one stop.
 * - Entries whose file has been deleted are skipped in the direction of travel
 *   instead of aborting the whole navigation.
 */
export class NavigationController {
	readonly history = new NavigationHistory();

	private readonly navigator: Navigator;
	private readonly settleMs: number;
	private readonly schedule: (callback: () => void, delayMs: number) => void;

	private queue: Direction[] = [];
	private draining: Promise<void> | null = null;
	private navigating = false;
	private token = 0;

	constructor(navigator: Navigator, options: NavigationControllerOptions = {}) {
		this.navigator = navigator;
		this.settleMs = options.settleMs ?? 150;
		this.schedule =
			options.schedule ?? ((callback, delayMs) => void globalThis.setTimeout(callback, delayMs));
	}

	/** `true` while the controller is moving the workspace itself. */
	get isNavigating(): boolean {
		return this.navigating;
	}

	/** Offer a freshly observed location to the history. */
	observe(location: Location, isJump = false): void {
		if (this.navigating) return;
		this.history.record(location, isJump);
	}

	/** Scrolling never adds a stop, but it does move the current one. */
	observeScroll(filePath: string, scrollLine: number | null): void {
		if (this.navigating) return;
		this.history.syncScroll(filePath, scrollLine);
	}

	go(direction: Direction): void {
		this.queue.push(direction);
		if (!this.draining) {
			this.draining = this.drain().finally(() => {
				this.draining = null;
			});
		}
	}

	/** Resolves once every queued navigation has been applied. */
	async settled(): Promise<void> {
		while (this.draining) await this.draining;
	}

	private async drain(): Promise<void> {
		let direction = this.queue.shift();
		while (direction) {
			try {
				await this.step(direction);
			} catch (error) {
				console.error('[evergreen-navigation] navigation failed', error);
			}
			direction = this.queue.shift();
		}
	}

	private async step(direction: Direction): Promise<void> {
		// Make sure where the user is looking right now is the head of the
		// history before moving away from it. Skipped while an earlier step is
		// still settling, because the history already points there.
		if (!this.navigating) {
			const current = this.navigator.captureCurrent();
			if (current) this.history.record(current, false);
		}

		let entry = this.advance(direction);
		let skipped = 0;

		while (entry && skipped < MAX_SKIP) {
			if (this.navigator.canOpen(entry)) {
				await this.move(entry);
				return;
			}
			skipped += 1;
			entry = this.advance(direction);
		}
	}

	private advance(direction: Direction): Location | null {
		return direction === 'back' ? this.history.back() : this.history.forward();
	}

	private async move(entry: Location): Promise<void> {
		const token = ++this.token;
		this.navigating = true;

		try {
			await this.navigator.open(entry);
			// The workspace may have clamped or refused the position. Adopting
			// what actually happened keeps the next observation from looking
			// like a brand new navigation.
			this.history.adopt(this.navigator.captureCurrent() ?? entry);
		} finally {
			this.schedule(() => {
				if (token === this.token) this.navigating = false;
			}, this.settleMs);
		}
	}
}
