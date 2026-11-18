# Product role catalog

Products can publish a read-only role catalog for Perminister at:

```text
GET /api/perminister/role-catalog
```

The endpoint must return `application/json` and may set `Cache-Control: no-store`. The response is public product metadata and must not include credentials, customer data, or organization-specific values.

```json
{
  "schemaVersion": 1,
  "productId": "example-product",
  "version": "1.0.0",
  "roles": [
    {
      "id": "project-viewer",
      "name": "Project viewer",
      "description": "View one project.",
      "role": "viewer",
      "scopeKinds": ["project"],
      "actions": ["example-product:project:read"]
    }
  ]
}
```

`productId` must match the product ID registered in Perminister. `version` uses semantic version format. Role `id` values are stable identifiers owned by the product; keep an ID when changing a role's label or permissions. `name` and `description` are for people. `actions` must be the exact action names the product already enforces. `scopeKinds` lists the allowed Perminister scopes: `product`, `project`, and/or `workspace`. The optional lowercase `role` value is returned to the product in consumer sessions when the product has existing semantic roles such as `viewer`, `editor`, or `admin`.

Perminister reads this fixed endpoint from the product's registered HTTPS website. It rejects private network addresses, cross-site redirects, oversized responses, mismatched product IDs, invalid actions, duplicate role IDs, and unsupported schemas. Fetching stages a catalog for review; it does not change assignments. An organization product administrator must review and apply the staged version. Applying updates future permission sets, while existing grants keep their action snapshots. Roles omitted by a later catalog are retired from new assignments and remain visible for audit.

Public product publishers own their catalog roles. Installed shared products receive the publisher's currently approved roles; each organization's existing grants remain unchanged.
