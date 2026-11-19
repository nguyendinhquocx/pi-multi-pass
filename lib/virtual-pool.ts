export interface VirtualPoolLike {
	name: string;
	baseProvider: string;
	asProvider?: boolean;
}

/** Explicit config wins; otherwise preserve the documented `*-free` pool convention. */
export function isVirtualPool(pool: VirtualPoolLike): boolean {
	return pool.asProvider ?? pool.name === `${pool.baseProvider}-free`;
}

export interface VirtualPoolMemberChoice {
	member: string;
	nextIndex: number;
}

/** Select the next healthy member in ring order, unless failover reserved one. */
export function chooseVirtualPoolMember(
	members: readonly string[],
	startIndex: number,
	available: ReadonlySet<string>,
	preferred?: string,
): VirtualPoolMemberChoice | undefined {
	if (members.length === 0 || available.size === 0) return undefined;
	const preferredIndex = preferred ? members.indexOf(preferred) : -1;
	if (preferredIndex >= 0 && available.has(preferred!)) {
		return { member: preferred!, nextIndex: (preferredIndex + 1) % members.length };
	}
	const start = ((startIndex % members.length) + members.length) % members.length;
	for (let offset = 0; offset < members.length; offset++) {
		const index = (start + offset) % members.length;
		if (available.has(members[index])) {
			return { member: members[index], nextIndex: (index + 1) % members.length };
		}
	}
	return undefined;
}
