# DID Service API

The DID (Direct Inward Dialing) service manages phone numbers used by the dialer. All routes are prefixed with `/api` and require Bearer authentication.

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/dids` | List DIDs for the current tenant. Supports `page`, `limit`, `search`, `isActive`, `areaCode` and `state` query params. Each DID includes its `usageCount` and recent call stats. |
| `POST` | `/dids` | Create a new DID. Body fields: `phoneNumber`, optional `description`, `areaCode`, `state`, `isActive`. |
| `PUT` | `/dids/:id` | Update a DID by ID. |
| `DELETE` | `/dids/:id` | Deactivate or delete a DID. Use query `force=true` to permanently remove. |
| `POST` | `/dids/bulk-import` | Upload a CSV file (as text) to create many DIDs at once. Each row should contain `phoneNumber` and optional `description`, `areaCode`, `state`, `isActive`. |
| `GET` | `/dids/:id/stats` | Retrieve usage statistics for a DID including total calls and conversion rate. |

### Bulk Import Example

```bash
curl -X POST http://localhost:3001/api/dids/bulk-import \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileContent": "phoneNumber,description\n18005550199,Support"}'
```

The response shows how many numbers were imported, failed or duplicated.
