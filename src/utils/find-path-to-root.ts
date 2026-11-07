/**
 * Find the shortest chain from a root to `start`, searching importers breadth
 * first. A root is a node with no importers. Returns undefined when no root is
 * reachable, such as for a node that only a cycle imports.
 */
export const findPathToRoot = <Node>(
	start: Node,
	getImporters: (node: Node) => Node[],
): Node[] | undefined => {
	// Each reached node points to the node it was reached from, toward start
	const next = new Map<Node, Node | undefined>([[start, undefined]]);
	const queue = [start];
	for (let index = 0; index < queue.length; index += 1) {
		const node = queue[index]!;
		const importers = getImporters(node);
		if (importers.length === 0) {
			const chain: Node[] = [];
			let current: Node | undefined = node;
			while (current !== undefined) {
				chain.push(current);
				current = next.get(current);
			}
			return chain;
		}

		for (const importer of importers) {
			if (!next.has(importer)) {
				next.set(importer, node);
				queue.push(importer);
			}
		}
	}
};
