# Inherited Responsibilities in Collibra

## How Inheritance Works

Responsibilities in Collibra follow a hierarchical inheritance model:

```
Community (e.g., Finance)
  ↓ inherits down
Domain (e.g., Accounting)
  ↓ inherits down
Asset (e.g., Customer Data)
```

If John is assigned as "Data Owner" at the **Finance Community** level, that responsibility inherits to all domains in Finance and further to all assets in those domains — even though John is not directly assigned to each individual asset.

## GraphQL vs REST

The **GraphQL API** returns only direct responsibilities:

> "The list of all responsibilities directly assigned to this organization. This list does not include inherited responsibilities."

The **REST API** supports inherited responsibilities via:

```
GET /rest/2.0/responsibilities?resourceIds={assetId}&includeInherited=true
```

This is what `get_asset_by_id` and `get_asset_responsibilities` use internally.

## How It's Implemented

Both `get_asset_by_id` and `get_asset_responsibilities` call the REST responsibilities endpoint with `includeInherited=true` and categorize results by comparing `baseResource.id`:

- **Direct** — `baseResource.id` matches the queried asset
- **Inherited from Domain** — `baseResource.resourceType` is `"Domain"`
- **Inherited from Community** — `baseResource.resourceType` is `"Community"`

## Response Structure

```json
{
  "responsibilities": {
    "summary": {
      "total": 5,
      "direct": 2,
      "inherited": 3,
      "inheritedFromCommunity": 2,
      "inheritedFromDomain": 1
    },
    "direct": [
      {
        "role": { "name": "Data Steward" },
        "owner": { "fullName": "Jane Smith" },
        "baseResource": { "name": "Customer Data", "resourceType": "Asset" }
      }
    ],
    "inherited": {
      "fromCommunity": [
        {
          "role": { "name": "Data Owner" },
          "owner": { "fullName": "John Doe" },
          "baseResource": { "name": "Finance", "resourceType": "Community" }
        }
      ],
      "fromDomain": [...]
    }
  }
}
```

All owner fields include resolved user names — see [USER_NAME_RESOLUTION_GUIDE.md](USER_NAME_RESOLUTION_GUIDE.md).
