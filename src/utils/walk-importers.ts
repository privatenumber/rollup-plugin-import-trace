/**
 * Follow one importer at a time from a module back to a root, stopping at a
 * cycle. Returns the chain from the root to the module.
 */
export const walkImporters = <Node>(
	start: Node,
	getImporter: (node: Node) => Node | undefined,
): Node[] => {
	const chain: Node[] = [];
	const visited = new Set<Node>();
	let current: Node | undefined = start;
	while (current !== undefined && !visited.has(current)) {
		visited.add(current);
		chain.push(current);
		current = getImporter(current);
	}

	// eslint-disable-next-line unicorn/no-array-reverse -- toReversed requires ES2023
	return chain.reverse();
};
