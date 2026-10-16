import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isJumpUserEvent } from '../src/editor-jumps.ts';

describe('isJumpUserEvent', () => {
	it('treats typing, deleting and plain movement as routine', () => {
		for (const event of ['input', 'input.type', 'delete', 'delete.backward', 'move', 'move.line', 'undo', 'redo']) {
			assert.equal(isJumpUserEvent(event), false, `${event} should be routine`);
		}
	});

	it('treats pointer selection as routine', () => {
		assert.equal(isJumpUserEvent('select'), false);
		assert.equal(isJumpUserEvent('select.pointer'), false);
	});

	it('treats search navigation as a jump', () => {
		assert.equal(isJumpUserEvent('select.search'), true);
	});

	it('treats plugin-driven and command-driven changes as jumps', () => {
		assert.equal(isJumpUserEvent('goto.heading'), true);
		assert.equal(isJumpUserEvent('vim.jump'), true);
	});

	it('does not treat a missing annotation as a jump', () => {
		assert.equal(isJumpUserEvent(undefined), false);
		assert.equal(isJumpUserEvent(null), false);
		assert.equal(isJumpUserEvent(''), false);
	});
});
