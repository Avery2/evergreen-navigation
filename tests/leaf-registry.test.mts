import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chooseLeaf, type LeafCandidate } from '../src/leaf-registry.ts';

interface FakeLeaf {
	name: string;
}

function leaf(name: string, filePath: string | null, isActive = false): LeafCandidate<FakeLeaf> {
	return { leaf: { name }, filePath, isActive };
}

describe('chooseLeaf', () => {
	it('opens a new tab when the note is not open anywhere', () => {
		const leaves = [leaf('main', 'a.md', true), leaf('stack-2', 'b.md')];
		assert.equal(chooseLeaf(leaves, 'c.md'), null);
	});

	it('reuses the existing tab for the note', () => {
		const leaves = [leaf('main', 'a.md', true), leaf('stack-2', 'b.md')];
		assert.equal(chooseLeaf(leaves, 'b.md')?.name, 'stack-2');
	});

	it('prefers the active tab when it already shows the note', () => {
		const leaves = [leaf('stack-1', 'b.md'), leaf('stack-2', 'b.md', true)];
		assert.equal(chooseLeaf(leaves, 'b.md')?.name, 'stack-2');
	});

	it('ignores non-file views', () => {
		const leaves = [leaf('graph', null, true), leaf('stack-1', 'a.md')];
		assert.equal(chooseLeaf(leaves, 'a.md')?.name, 'stack-1');
	});

	it('returns the first match when nothing is active', () => {
		const leaves = [leaf('stack-1', 'a.md'), leaf('stack-2', 'a.md')];
		assert.equal(chooseLeaf(leaves, 'a.md')?.name, 'stack-1');
	});
});
