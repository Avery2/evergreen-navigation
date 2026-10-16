/**
 * Which tab should receive a historical location?
 *
 * Kept generic (and free of Obsidian imports) so the rule can be unit tested:
 * the caller passes one candidate per open leaf and gets the leaf back, or
 * `null` meaning "nothing is showing that file, open a new tab".
 */

export interface LeafCandidate<TLeaf> {
	/** The leaf object itself; opaque to this module. */
	leaf: TLeaf;
	/** Vault path the leaf is currently showing, or `null` for non-file views. */
	filePath: string | null;
	/** Whether this leaf is the workspace's active leaf. */
	isActive: boolean;
}

/**
 * Pick the leaf that already shows `targetPath`.
 *
 * Preference order:
 * 1. the active leaf, when it already shows the target (least disruption),
 * 2. otherwise the first leaf showing the target.
 *
 * Returns `null` when the note is not open anywhere.
 */
export function chooseLeaf<TLeaf>(
	candidates: readonly LeafCandidate<TLeaf>[],
	targetPath: string
): TLeaf | null {
	const matches = candidates.filter((candidate) => candidate.filePath === targetPath);
	if (matches.length === 0) return null;

	const active = matches.find((candidate) => candidate.isActive);
	return (active ?? matches[0]).leaf;
}
