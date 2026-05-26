# User Name Resolution

## The Problem

The Collibra `/responsibilities` endpoint returns owner references with just a UUID:

```json
{
  "role": { "name": "Data Owner" },
  "owner": { "id": "a1b2c3d4-...", "resourceType": "User" }
}
```

## The Solution

`get_asset_by_id` and `get_asset_responsibilities` automatically resolve user names by:

1. Collecting all unique user/group IDs from responsibilities
2. Batch-fetching user details in a single API call (`GET /users?userId=id1&userId=id2&...`)
3. Batch-fetching group details similarly (`GET /userGroups?groupId=id1&...`)
4. Enriching each responsibility with the full details

### Resolved User Output

```json
{
  "role": { "name": "Data Owner" },
  "owner": {
    "id": "a1b2c3d4-...",
    "resourceType": "User",
    "userName": "john.doe",
    "firstName": "John",
    "lastName": "Doe",
    "fullName": "John Doe",
    "emailAddress": "john.doe@company.com"
  }
}
```

### Resolved Group Output

```json
{
  "role": { "name": "Data Steward" },
  "owner": {
    "id": "group-456",
    "resourceType": "UserGroup",
    "name": "Data Governance Team"
  }
}
```

## Performance

The batch approach uses 2 API calls total (one for users, one for groups) regardless of how many responsibilities exist. An asset with 20 responsibilities involving 15 users and 3 groups still only requires 2 extra API calls.

Edge cases handled:
- Empty responsibilities — no extra calls made
- Duplicate users — deduplicated via `Set`
- Failed user lookups — falls back gracefully to UUID
**Result:** Full names, emails, usernames for all responsibilities

Now when you query responsibilities, you'll see:
- ✅ "John Doe is the Data Owner (inherited from Finance)"

Instead of:
- ❌ "a1b2c3d4-e5f6-7890-abcd-ef1234567890 is the Data Owner..."

Much better! 🎉
