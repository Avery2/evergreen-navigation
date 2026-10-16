/**
 * Classify CodeMirror 6 transactions for the within-note history heuristic.
 *
 * Deliberately takes a plain `string | null` instead of a `Transaction` so the
 * rule is testable without pulling CodeMirror into the test process.
 */

/**
 * User events that mean "the cursor moved, but the user did not go anywhere".
 * Everything else (link clicks, `go to heading`, outline jumps, vim motions
 * from plugins, …) counts as a deliberate jump.
 */
const ROUTINE_USER_EVENTS = ['input', 'delete', 'move', 'select', 'undo', 'redo'];

/**
 * `true` when the transaction looks like a deliberate jump rather than typing,
 * selecting or arrow-key movement.
 *
 * Search navigation is called out explicitly: CodeMirror reports it as
 * `select.search`, which the `select` prefix would otherwise swallow.
 */
export function isJumpUserEvent(userEvent: string | null | undefined): boolean {
	if (!userEvent) return false;

	const event = userEvent.toLowerCase();
	if (event.includes('search')) return true;

	return !ROUTINE_USER_EVENTS.some(
		(routine) => event === routine || event.startsWith(`${routine}.`)
	);
}
