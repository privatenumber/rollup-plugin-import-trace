/**
 * Find the shortest chain from a root to `start`, searching importers breadth
 * first. A root is a node with no importers. When none is reachable, such as
 * when the entry is part of an import cycle, the root is the first node whose
 * importers were all reached before it, which closes the cycle.
 */
export const findPathToRoot = <Node>(
	start: Node,
	getImporters: (node: Node) => Node[],
): Node[] => {
	// Each reached node points to the node it was reached from, toward start
	const next = new Map<Node, Node | undefined>([[start, undefined]]);
	const getChain = (root: Node) => {
		const chain: Node[] = [];
		let current: Node | undefined = root;
		while (current !== undefined) {
			chain.push(current);
			current = next.get(current);
		}
		return chain;
	};

	const queue = [start];
	let cycleRoot: Node | undefined;
	for (let index = 0; index < queue.length; index += 1) {
		const node = queue[index]!;
		const importers = getImporters(node);
		if (importers.length === 0) {
			return getChain(node);
		}

		let reachesNewNode = false;
		for (const importer of importers) {
			if (!next.has(importer)) {
				next.set(importer, node);
				queue.push(importer);
				reachesNewNode = true;
			}
		}
		if (!reachesNewNode) {
			cycleRoot ??= node;
		}
	}

	// The last node reached has only reached importers, so this is set
	return getChain(cycleRoot!);
};
