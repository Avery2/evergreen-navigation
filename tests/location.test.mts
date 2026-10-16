import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { anchorLine, relateLocations, sameLocation } from '../src/location.ts';
import { at, reading } from './helpers.mts';

describe('anchorLine', () => {
	it('prefers the top of the selection', () => {
		const location = {
			filePath: 'a.md',
			cursor: { from: { line: 40, ch: 0 }, to: { line: 12, ch: 0 } },
			scrollLine: 5,
		};
		assert.equal(anchorLine(location), 12);
	});

	it('falls back to the scroll position when there is no cursor', () => {
		assert.equal(anchorLine(reading('a.md', 30)), 30);
	});

	it('reports nothing when neither is known', () => {
		assert.equal(anchorLine(reading('a.md', null)), null);
	});
});

describe('relateLocations', () => {
	it('calls different files distant', () => {
		assert.equal(relateLocations(at('a.md', 1), at('b.md', 1)), 'distant');
	});

	it('calls the same line identical', () => {
		assert.equal(relateLocations(at('a.md', 7), at('a.md', 7)), 'identical');
	});

	it('groups movement under the threshold as nearby', () => {
		assert.equal(relateLocations(at('a.md', 7), at('a.md', 16)), 'nearby');
	});

	it('treats exactly the threshold as distant', () => {
		assert.equal(relateLocations(at('a.md', 7), at('a.md', 17)), 'distant');
	});

	it('compares reading-mode scroll anchors', () => {
		assert.equal(relateLocations(reading('a.md', 100), reading('a.md', 105)), 'nearby');
		assert.equal(relateLocations(reading('a.md', 100), reading('a.md', 400)), 'distant');
	});

	it('stays conservative when one side has no anchor', () => {
		assert.equal(relateLocations(at('a.md', 1), reading('a.md', null)), 'nearby');
	});
});

describe('sameLocation', () => {
	it('is true for equal positions', () => {
		assert.equal(sameLocation(at('a.md', 3), at('a.md', 3)), true);
	});

	it('is false when only the column differs', () => {
		assert.equal(sameLocation(at('a.md', 3, 0), at('a.md', 3, 5)), false);
	});

	it('is false when only the scroll differs', () => {
		const a = at('a.md', 3);
		assert.equal(sameLocation(a, { ...a, scrollLine: 99 }), false);
	});
});
