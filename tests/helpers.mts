import type { CursorState, Location } from '../src/location.ts';

/** Build a location with a cursor, as captured in editing / live-preview mode. */
export function at(filePath: string, line: number, ch = 0): Location {
	const cursor: CursorState = { from: { line, ch }, to: { line, ch } };
	return { filePath, cursor, scrollLine: line };
}

/** Build a location with no cursor, as captured in reading mode. */
export function reading(filePath: string, scrollLine: number | null): Location {
	return { filePath, cursor: null, scrollLine };
}

/** Compact, assertion-friendly summary of a history: `a.md:1 -> b.md:2`. */
export function summary(locations: readonly Location[]): string[] {
	return locations.map((location) => {
		const line = location.cursor?.from.line ?? location.scrollLine;
		return line === null ? location.filePath : `${location.filePath}:${line}`;
	});
}
