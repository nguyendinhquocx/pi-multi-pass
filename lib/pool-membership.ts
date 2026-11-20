/** One-pool-per-account invariant shared by every pool membership mutation
 *  path (/subs account menu, /pool list members, /pool create).
 *  Pure logic on plain config shapes so node tests can import it directly. */

export interface MembershipPoolLike {
	name: string;
	baseProvider: string;
	members: string[];
	enabled?: boolean;
	asProvider?: boolean;
}

/** Every pool that currently contains `member` (any base provider). */
export function findMemberPools<T extends MembershipPoolLike>(pools: readonly T[], member: string): T[] {
	return pools.filter((pool) => pool.members.includes(member));
}

/** Members that belong to more than one pool (legacy config conflict). */
export function findDuplicateMembershipMembers(pools: readonly MembershipPoolLike[]): string[] {
	const seenOnce = new Set<string>();
	const duplicated = new Set<string>();
	for (const pool of pools) {
		for (const member of pool.members) {
			if (seenOnce.has(member)) duplicated.add(member);
			else seenOnce.add(member);
		}
	}
	return [...duplicated];
}

/**
 * Enforce the invariant: `member` belongs to at most one pool.
 * - `targetPoolName === null` removes the member from every pool.
 * - Otherwise the member is removed from every other pool and appended to
 *   the target pool when missing. Empty pools are kept for reuse.
 * Mutates `pools` in place; returns where the member came from.
 */
export function applyPoolMembership(
	pools: MembershipPoolLike[],
	member: string,
	targetPoolName: string | null,
): { joined?: string; removedFrom: string[] } {
	const removedFrom: string[] = [];
	for (const pool of pools) {
		if (pool.name === targetPoolName) continue;
		const index = pool.members.indexOf(member);
		if (index >= 0) {
			pool.members.splice(index, 1);
			removedFrom.push(pool.name);
		}
	}
	if (targetPoolName !== null) {
		const target = pools.find((pool) => pool.name === targetPoolName);
		if (target && !target.members.includes(member)) target.members.push(member);
		return { joined: target?.name, removedFrom };
	}
	return { removedFrom };
}

/** Default pool name `<baseProvider>-pool`, bumped with a numeric suffix
 *  when an existing pool (of any base) already owns the name. */
export function defaultPoolName(pools: readonly MembershipPoolLike[], baseProvider: string): string {
	const taken = new Set(pools.map((pool) => pool.name));
	if (!taken.has(`${baseProvider}-pool`)) return `${baseProvider}-pool`;
	let suffix = 2;
	while (taken.has(`${baseProvider}-pool-${suffix}`)) suffix += 1;
	return `${baseProvider}-pool-${suffix}`;
}
