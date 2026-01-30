import { expect } from 'manten';

export const expectMatchesInOrder = (
	text: string,
	patterns: RegExp[],
) => {
	let lastIndex = 0;
	for (const pattern of patterns) {
		const match = text.slice(lastIndex).match(pattern);
		expect(match).toBeTruthy();
		lastIndex += match!.index! + match![0].length;
	}
};
