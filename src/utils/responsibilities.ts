import type { CollibraClient } from './collibra-client.js';
import { chunk } from './concurrency.js';

/**
 * Shared responsibility helpers for get_asset_by_id and
 * get_asset_responsibilities: resolve owner user/group details in batches and
 * split responsibilities into direct vs inherited (by community / domain).
 */

/** Batch-fetch users or groups by id; failures degrade to "no details" (owners keep their ids). */
async function fetchByIds(client: CollibraClient, path: string, param: string, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  // Chunked so a long id list can't exceed URL length limits.
  for (const batch of chunk(ids, 100)) {
    try {
      const qs = batch.map((id) => `${param}=${encodeURIComponent(id)}`).join('&');
      const resp = await client.restCall<any>(`${path}?${qs}&limit=1000`);
      for (const r of resp.results || []) map.set(r.id, r);
    } catch {
      /* non-critical: owners are still identified by id */
    }
  }
  return map;
}

/** Add userName/fullName/email (users) or name/description (groups) to each responsibility's owner. */
export async function enrichResponsibilityOwners(client: CollibraClient, responsibilities: any[]): Promise<any[]> {
  const ownerIds = (type: string) => [
    ...new Set(responsibilities.filter((r) => r.owner?.id && r.owner.resourceType === type).map((r) => r.owner.id as string)),
  ];
  const [users, groups] = await Promise.all([
    fetchByIds(client, '/rest/2.0/users', 'userId', ownerIds('User')),
    fetchByIds(client, '/rest/2.0/userGroups', 'userGroupId', ownerIds('UserGroup')),
  ]);
  return responsibilities.map((r) => {
    if (r.owner?.resourceType === 'User') {
      const u = users.get(r.owner.id);
      if (u) {
        return {
          ...r,
          owner: {
            ...r.owner,
            userName: u.userName,
            firstName: u.firstName,
            lastName: u.lastName,
            fullName: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.userName,
            emailAddress: u.emailAddress,
          },
        };
      }
    } else if (r.owner?.resourceType === 'UserGroup') {
      const g = groups.get(r.owner.id);
      if (g) return { ...r, owner: { ...r.owner, name: g.name, description: g.description } };
    }
    return { ...r };
  });
}

/** Split responsibilities on an asset into direct and inherited (and inherited by level). */
export function categorizeResponsibilities(responsibilities: any[], assetId: string) {
  const direct = responsibilities.filter((r) => r.baseResource?.id === assetId);
  const inherited = responsibilities.filter((r) => r.baseResource?.id !== assetId);
  return {
    direct,
    inherited,
    inheritedByCommunity: inherited.filter((r) => r.baseResource?.resourceType === 'Community'),
    inheritedByDomain: inherited.filter((r) => r.baseResource?.resourceType === 'Domain'),
  };
}
