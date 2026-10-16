import { relateLocations, sameLocation, type Location } from './location.ts';

/** Upper bound on remembered locations. Oldest entries are dropped first. */
export const MAX_ENTRIES = 200;

export type RecordOutcome =
	/** A new stop was appended (and any forward history discarded). */
	| 'pushed'
	/** The current stop was refined in place (no new stop, no truncation). */
	| 'replaced'
	/** Nothing changed. */
	| 'ignored';

/**
 * A browser-style history: an ordered list of locations plus a cursor.
 *
 * Invariants:
 * - `entries[position]` is always the place the user is *currently* at
 *   (as far as the plugin knows).
 * - Recording a genuinely new place truncates everything after `position`.
 * - `back()` / `forward()` only move the cursor; they never record.
 */
export class NavigationHistory {
	private entries: Location[] = [];
	private position = -1;

	/** Read-only view, used by tests and the debug command. */
	get all(): readonly Location[] {
		return this.entries;
	}

	get size(): number {
		return this.entries.length;
	}

	get index(): number {
		return this.position;
	}

	get current(): Location | null {
		return this.position >= 0 ? this.entries[this.position] : null;
	}

	get canGoBack(): boolean {
		return this.position > 0;
	}

	get canGoForward(): boolean {
		return this.position >= 0 && this.position < this.entries.length - 1;
	}

	/**
	 * Offer a freshly observed location to the history.
	 *
	 * @param isJump whether the observation came from a deliberate navigation
	 *   (internal link, outline click, search result, "go to heading"), as
	 *   opposed to ordinary cursor movement.
	 */
	record(location: Location, isJump = false): RecordOutcome {
		const current = this.current;

		if (!current) {
			this.push(location);
			return 'pushed';
		}

		if (sameLocation(current, location)) return 'ignored';

		const relation = relateLocations(current, location);

		if (relation === 'distant' || (relation === 'nearby' && isJump)) {
			this.push(location);
			return 'pushed';
		}

		// Same stop: keep the entry fresh (cursor column, scroll offset) so that
		// going back later restores where the user actually left off.
		this.entries[this.position] = location;
		return 'replaced';
	}

	/**
	 * Update the scroll anchor of the current entry without creating a stop.
	 * Scrolling is not navigation, but it is where the user was.
	 */
	syncScroll(filePath: string, scrollLine: number | null): void {
		const current = this.current;
		if (!current || current.filePath !== filePath) return;
		if (current.scrollLine === scrollLine) return;
		this.entries[this.position] = { ...current, scrollLine };
	}

	/**
	 * Re-point the current entry at where the workspace *actually* ended up.
	 *
	 * After restoring a position Obsidian may clamp it (the note got shorter)
	 * or refuse it (the mode changed). Adopting the real position keeps the
	 * invariant above, which stops the next observation from looking like a
	 * brand new navigation and destroying forward history.
	 */
	adopt(location: Location): void {
		const current = this.current;
		if (!current || current.filePath !== location.filePath) return;
		this.entries[this.position] = location;
	}

	back(): Location | null {
		if (!this.canGoBack) return null;
		this.position -= 1;
		return this.entries[this.position];
	}

	forward(): Location | null {
		if (!this.canGoForward) return null;
		this.position += 1;
		return this.entries[this.position];
	}

	/** Follow a file that was renamed or moved inside the vault. */
	remapPath(oldPath: string, newPath: string): void {
		for (const entry of this.entries) {
			if (entry.filePath === oldPath) entry.filePath = newPath;
		}
	}

	clear(): void {
		this.entries = [];
		this.position = -1;
	}

	private push(location: Location): void {
		if (this.position < this.entries.length - 1) {
			this.entries.length = this.position + 1;
		}

		this.entries.push(location);

		if (this.entries.length > MAX_ENTRIES) {
			this.entries.splice(0, this.entries.length - MAX_ENTRIES);
		}

		this.position = this.entries.length - 1;
	}
}
