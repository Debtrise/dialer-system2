# OptiSigns Service API

These endpoints integrate with the OptiSigns digital signage platform. All routes require authentication and assume the tenant has configured an OptiSigns API token.

## Configuration
| Method | Path | Description |
| ------ | ---- | ----------- |
| `PUT` | `/optisigns/config` | Store or update the API token and settings. |
| `GET` | `/optisigns/config` | Retrieve current configuration. |
| `POST` | `/optisigns/config/test` | Verify that a provided token is valid. |
| `GET` | `/optisigns/status` | Check connection status and statistics. |

## Displays
| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/optisigns/displays/sync` | Synchronize displays from OptiSigns. |
| `GET` | `/optisigns/displays` | List displays stored locally. |
| `GET` | `/optisigns/displays/:id` | Get a single display and recent events. |
| `PUT` | `/optisigns/displays/:id` | Update a display in OptiSigns and locally. |
| `POST` | `/optisigns/displays/:id/tags` | Add tags to a display. |
| `DELETE` | `/optisigns/displays/:id/tags` | Remove tags from a display. |
| `POST` | `/optisigns/displays/:id/takeover` | Temporarily override a display. |
| `POST` | `/optisigns/displays/:id/stop-takeover` | Stop the takeover. |
| `GET` | `/optisigns/displays/:id/takeover-status` | Check takeover status. |
| `GET` | `/optisigns/takeovers` | List active takeovers. |
| `POST` | `/optisigns/displays/:id/push` | Push content to a display. |

### Display JSON Format
All services expose displays using the same camelCase schema:

```json
{
  "id": "uuid",
  "tenantId": "string",
  "optisignsDisplayId": "string",
  "name": "string",
  "uuid": "string",
  "location": "string",
  "status": "string",
  "isActive": true,
  "isOnline": true
}
```

## Assets
| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/optisigns/assets/upload` | Upload a file asset. |
| `POST` | `/optisigns/assets/website` | Create a website asset. |
| `POST` | `/optisigns/assets/sync` | Synchronize assets from OptiSigns. |
| `GET` | `/optisigns/assets` | List assets stored locally. |

