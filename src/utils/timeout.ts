/**
 * Returned by a timeout promise when its time runs out
 */
export const timedOut = Symbol('timedOut');

/**
 * A promise that resolves to `timedOut` after `ms`. Its timer does not keep
 * the process alive.
 */
export const createTimeout = (ms: number) => new Promise<typeof timedOut>((resolve) => {
	setTimeout(resolve, ms, timedOut).unref();
});
