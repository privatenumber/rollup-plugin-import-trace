/**
 * The indices of a list of `length` items, alternately from its end and its
 * start: last, first, second last, second, and so on. Each index is visited
 * once. `fromEnd` tells which end it came from.
 */
export function* fromBothEnds(length: number) {
	let end = length - 1;
	let start = 0;
	while (start <= end) {
		yield {
			index: end,
			fromEnd: true,
		};
		end -= 1;
		if (start <= end) {
			yield {
				index: start,
				fromEnd: false,
			};
			start += 1;
		}
	}
}
