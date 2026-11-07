/**
 * Run an action and return its result, or `undefined` if it throws
 */
export const attempt = <T>(action: () => T): T | undefined => {
	try {
		return action();
	} catch {
		return undefined;
	}
};
