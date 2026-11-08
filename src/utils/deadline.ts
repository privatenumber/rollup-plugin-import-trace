/**
 * Returned by `deadline.expired` when the time runs out
 */
export const timedOut = Symbol('timedOut');

/**
 * A time limit for a sequence of steps. `expired` resolves to `timedOut`
 * when the time runs out; race it against a step that may never settle.
 * `isPast()` checks the time between steps, because steps that settle
 * without yielding to the event loop keep the timer from running.
 *
 * The timer keeps the process alive, so a step that waits on nothing else
 * still ends at the deadline. Dispose the deadline to clear it.
 */
export const createDeadline = (ms: number) => {
	const end = performance.now() + ms;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<typeof timedOut>((resolve) => {
		timer = setTimeout(resolve, ms, timedOut);
	});
	return {
		expired,
		isPast: () => performance.now() >= end,
		[Symbol.dispose]: () => clearTimeout(timer),
	};
};

export type Deadline = ReturnType<typeof createDeadline>;
