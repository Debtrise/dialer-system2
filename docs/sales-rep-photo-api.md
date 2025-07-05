# Sales Rep Photo API

These endpoints let you upload and manage sales rep photos used in announcement templates. All routes require Bearer authentication and are prefixed with `/api`.

When using the Content Creator, you can place a photo on the canvas by adding an element with `elementType: "sales_rep_photo"`. The element automatically binds to the `{rep_photo}` variable so that the correct representative's image is displayed when a deal is closed.
You can upload photos one at a time using `/sales-rep-photos/upload` or upload many using a CSV at `/sales-rep-photos/bulk-csv`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/sales-rep-photos/upload` | Upload a photo for a single sales rep. Form fields: `photo`, `repEmail`, optional `repName`. |
| `POST` | `/sales-rep-photos/bulk-csv` | Upload a CSV of reps with `name`, `email` and `photoUrl` columns to create users and fetch their photos. |
| `POST` | `/sales-rep-photos/fallback` | Set or replace the default fallback photo shown when a rep photo is missing. |
| `GET` | `/sales-rep-photos/fallback` | Retrieve the current fallback photo. Returns 404 if not configured. |
| `GET` | `/sales-rep-photos/by-email/:email` | Fetch a photo asset by rep email address. |
| `GET` | `/sales-rep-photos` | List uploaded sales rep photos with pagination. Supports `page` and `limit` query params. |
| `POST` | `/sales-rep-photos/generate-video` | Produce a celebration video using the rep photo. Body fields: `repEmail`, optional `repName`, `dealAmount`, `companyName`. |
| `DELETE` | `/sales-rep-photos/:id` | Delete a photo asset by ID. |

### Fallback photo
If a sales rep photo isn't found for the provided email, the webhook logs a
message similar to `No photo found for someone@example.com and no fallback
configured`. Upload a default image using the `/sales-rep-photos/fallback`
endpoint so the system can display it whenever a rep photo is missing.

## Quick Test
The setup script provides example commands for uploading a photo and triggering a webhook:

```bash
curl -X POST http://localhost:3001/api/sales-rep-photos/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "photo=@test.jpg" \
  -F "repEmail=john@company.com" \
  -F "repName=John Doe"
```

Upload many reps at once from a CSV file with `name`, `email` and `photoUrl` columns:

```bash
curl -X POST http://localhost:3001/api/sales-rep-photos/bulk-csv \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "csv=@reps.csv"
```

```bash
curl -X POST http://localhost:3001/api/webhooks/endpoint/YOUR_ENDPOINT_KEY \
  -H "Authorization: Bearer YOUR_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "salesRep": {"name": "John Doe", "email": "john@company.com"},
    "deal": {"value": "$50,000"},
    "client": {"company": "Acme Corp"}
  }'
```
