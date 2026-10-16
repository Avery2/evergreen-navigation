import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_ENTRIES, NavigationHistory } from '../src/history-stack.ts';
import { at, reading, summary } from './helpers.mts';

describe('NavigationHistory.record', () => {
	it('starts empty', () => {
		const history = new NavigationHistory();
		assert.equal(history.size, 0);
		assert.equal(history.current, null);
		assert.equal(history.canGoBack, false);
		assert.equal(history.canGoForward, false);
	});

	it('pushes the first location', () => {
		const history = new NavigationHistory();
		assert.equal(history.record(at('a.md', 1)), 'pushed');
		assert.deepEqual(summary(history.all), ['a.md:1']);
		assert.equal(history.canGoBack, false);
	});

	it('ignores an identical observation', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 1));
		assert.equal(history.record(at('a.md', 1)), 'ignored');
		assert.equal(history.size, 1);
	});

	it('refines the current stop for nearby movement', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 1));
		assert.equal(history.record(at('a.md', 8)), 'replaced');
		assert.equal(history.size, 1);
		assert.deepEqual(summary(history.all), ['a.md:8']);
	});

	it('starts a new stop for a nearby movement that is a jump', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 1));
		assert.equal(history.record(at('a.md', 3), true), 'pushed');
		assert.deepEqual(summary(history.all), ['a.md:1', 'a.md:3']);
	});

	it('starts a new stop for distant movement in the same file', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 1));
		assert.equal(history.record(at('a.md', 40)), 'pushed');
		assert.deepEqual(summary(history.all), ['a.md:1', 'a.md:40']);
	});

	it('starts a new stop when the file changes', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 1));
		assert.equal(history.record(at('b.md', 1)), 'pushed');
		assert.deepEqual(summary(history.all), ['a.md:1', 'b.md:1']);
	});

	it('uses the scroll anchor for reading-mode notes', () => {
		const history = new NavigationHistory();
		history.record(reading('a.md', 10));
		assert.equal(history.record(reading('a.md', 14)), 'replaced');
		assert.equal(history.record(reading('a.md', 300)), 'pushed');
		assert.deepEqual(summary(history.all), ['a.md:14', 'a.md:300']);
	});
});

describe('NavigationHistory back / forward', () => {
	it('moves the cursor without recording anything', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 1));
		history.record(at('b.md', 1));
		history.record(at('c.md', 1));

		assert.equal(history.back()?.filePath, 'b.md');
		assert.equal(history.back()?.filePath, 'a.md');
		assert.equal(history.back(), null);
		assert.equal(history.size, 3);

		assert.equal(history.forward()?.filePath, 'b.md');
		assert.equal(history.forward()?.filePath, 'c.md');
		assert.equal(history.forward(), null);
		assert.equal(history.size, 3);
	});

	it('discards forward history when a new location is visited', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 1));
		history.record(at('b.md', 1));
		history.record(at('c.md', 1));

		history.back();
		history.back();
		assert.equal(history.canGoForward, true);

		history.record(at('d.md', 1));

		assert.deepEqual(summary(history.all), ['a.md:1', 'd.md:1']);
		assert.equal(history.canGoForward, false);
	});

	it('drops the oldest entries once the cap is reached', () => {
		const history = new NavigationHistory();
		for (let i = 0; i < MAX_ENTRIES + 1; i++) {
			history.record(at('a.md', i * 20));
		}
		assert.equal(history.size, MAX_ENTRIES);
		assert.equal(history.all[0]?.cursor?.from.line, 20);
	});
});

describe('NavigationHistory bookkeeping', () => {
	it('follows a renamed file', () => {
		const history = new NavigationHistory();
		history.record(at('old.md', 5));
		history.record(at('other.md', 5));
		history.remapPath('old.md', 'new.md');
		assert.deepEqual(summary(history.all), ['new.md:5', 'other.md:5']);
	});

	it('adopts the real position only for the same file', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 400));

		history.adopt(at('a.md', 99));
		assert.deepEqual(summary(history.all), ['a.md:99']);

		history.adopt(at('b.md', 1));
		assert.deepEqual(summary(history.all), ['a.md:99']);
	});

	it('syncs the scroll anchor without adding a stop', () => {
		const history = new NavigationHistory();
		history.record(reading('a.md', 10));

		history.syncScroll('a.md', 500);
		assert.deepEqual(summary(history.all), ['a.md:500']);
		assert.equal(history.size, 1);
	});

	it('ignores scroll sync for a different file', () => {
		const history = new NavigationHistory();
		history.record(reading('a.md', 10));
		history.syncScroll('b.md', 500);
		assert.deepEqual(summary(history.all), ['a.md:10']);
	});

	it('clears everything', () => {
		const history = new NavigationHistory();
		history.record(at('a.md', 1));
		history.clear();
		assert.equal(history.size, 0);
		assert.equal(history.current, null);
	});
});
