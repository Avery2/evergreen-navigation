/**
 * The pure model of "a place in the vault".
 *
 * This module deliberately has **no imports** so it can be unit tested with
 * plain `node --test` (and so the history rules stay easy to reason about).
 */

/** A cursor position, matching Obsidian's own `EditorPosition` shape. */
export interface EditorPosition {
	line: number;
	ch: number;
}

/** A selection, matching Obsidian's ephemeral-state `cursor` shape. */
export interface CursorState {
	from: EditorPosition;
	to: EditorPosition;
}

/**
 * A remembered place: a file, plus the best position information we could
 * capture for it.
 *
 * - `cursor` is present in editing / live-preview mode.
 * - `scrollLine` is the line at the top of the viewport. It is present in both
 *   modes (Obsidian reports it as a fractional line number) and is the only
 *   position information available in reading mode.
 */
export interface Location {
	filePath: string;
	cursor: CursorState | null;
	scrollLine: number | null;
}

/**
 * Cursor movements shorter than this many lines are treated as one history
 * stop. Ten lines is roughly "still reading the same passage", and it is the
 * same threshold used by the upstream Cursor History plugin.
 */
export const LINE_THRESHOLD = 10;

export type LocationRelation = 'identical' | 'nearby' | 'distant';

/**
 * The single line used to compare two locations.
 *
 * The cursor wins when we have one because it is what the user is looking at
 * in editing mode. Otherwise we fall back to the top visible line.
 */
export function anchorLine(location: Location): number | null {
	if (location.cursor) {
		return Math.min(location.cursor.from.line, location.cursor.to.line);
	}
	return location.scrollLine;
}

/**
 * How far apart two locations are, for history purposes.
 *
 * `identical` means "same stop, refine it in place"; `nearby` means "probably
 * just reading around the same spot"; `distant` means "somewhere else".
 */
export function relateLocations(a: Location, b: Location): LocationRelation {
	if (a.filePath !== b.filePath) return 'distant';

	const lineA = anchorLine(a);
	const lineB = anchorLine(b);

	// One side has no usable position (e.g. a freshly loaded view). Be
	// conservative: do not invent a new stop unless something explicitly says
	// this was a jump.
	if (lineA === null || lineB === null) return 'nearby';

	const distance = Math.abs(lineA - lineB);
	if (distance === 0) return 'identical';
	return distance < LINE_THRESHOLD ? 'nearby' : 'distant';
}

/** Strict equality, used to avoid pointless writes. */
export function sameLocation(a: Location, b: Location): boolean {
	return (
		a.filePath === b.filePath &&
		a.scrollLine === b.scrollLine &&
		samePosition(a.cursor?.from ?? null, b.cursor?.from ?? null) &&
		samePosition(a.cursor?.to ?? null, b.cursor?.to ?? null)
	);
}

function samePosition(a: EditorPosition | null, b: EditorPosition | null): boolean {
	if (a === null || b === null) return a === b;
	return a.line === b.line && a.ch === b.ch;
}

/** Human readable summary, used in debug logging and tests. */
export function describeLocation(location: Location): string {
	const line = anchorLine(location);
	return line === null ? location.filePath : `${location.filePath}:${line}`;
}
