# API Documentation

This document provides an overview of the HTTP endpoints for the **Content Creation** and **OptiSigns** services exposed by this project. All routes are mounted under `/api`.

## Authentication

Most routes require Bearer authentication. The authenticated user's `tenantId` is used to scope data. Public OptiSync endpoints accept an API token header instead.

---

## Content Creation API

Base path: `/api/content`

### OptiSync Endpoints

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET`  | `/optisync/projects/:projectId/feed` | Generate a data feed for a project in OptiSync format. Supports query params `format`, `includeElements`, `includeAssets`, `lastUpdated`. |
| `GET`  | `/optisync/projects` | List projects available for OptiSync. Supports `limit`, `page`, `status`. |
| `POST` | `/optisync/projects/:projectId/webhook` | Webhook endpoint for OptiSigns notifications (e.g. refresh or validate). |
| `GET`  | `/optisync/projects/:projectId/config` | Create OptiSigns API Gateway configuration for a project. |
| `GET`  | `/optisync/status` | Returns integration status for the current tenant. |

### Public Content

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/public/:exportId` | Serve published content by export ID. |
| `GET` | `/debug/:exportId` | Debug view for a published export. |

### Templates

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/templates` | List templates. Supports filtering by category, visibility and search. |
| `GET` | `/templates/:templateId` | Retrieve a single template. |
| `POST` | `/templates` | Create a template. |

### Projects

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/projects` | List projects. Supports `status`, `search`, `page`, `limit`. |
| `POST` | `/projects` | Create a new project. |
| `GET` | `/projects/:projectId` | Retrieve a project with its elements. |
| `PUT` | `/projects/:projectId` | Update project metadata. |
| `DELETE` | `/projects/:projectId` | Delete a project. |

### Project Elements

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/projects/:projectId/elements` | Add a new element to a project. |
| `PUT` | `/projects/:projectId/elements/:elementId` | Update an element. |
| `DELETE` | `/projects/:projectId/elements/:elementId` | Remove an element from a project. |
| `PUT` | `/projects/:projectId/elements/reorder` | Reorder elements within a project. |

### Assets

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/assets` | List uploaded assets. |
| `POST` | `/assets/upload` | Upload a file asset (images, video, audio, fonts). |
| `DELETE` | `/assets/:assetId` | Delete an unused asset. |

### Variables

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/variables` | List available variables grouped by category. |
| `POST` | `/variables` | Create a custom variable. |
| `POST` | `/variables/initialize-system` | Initialize default system variables. |

### Preview and Publish

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/projects/:projectId/preview` | Generate a preview for a project. Body accepts `{ device: "desktop" | "mobile" }`. |
| `POST` | `/projects/:projectId/publish` | Publish a project to OptiSigns. Body accepts `{ displayIds: [] }`. |
| `GET` | `/exports/:exportId/status` | Check export processing status. |

### System Status

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/system/status` | Returns health information and integration details. |

---

## OptiSigns Service API

Base path: `/api/optisigns`

### Configuration

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `PUT` | `/config` | Save or update the OptiSigns API token and settings. |
| `GET` | `/config` | Retrieve current configuration for the tenant. |
| `POST` | `/config/test` | Test an API token to verify connectivity. |
| `GET` | `/status` | Check if the integration is configured and available. |

### Displays

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/displays/sync` | Synchronize display list from OptiSigns. |
| `GET` | `/displays` | List displays with optional filters (`status`, `isOnline`, `location`). |
| `GET` | `/displays/:id` | Retrieve display details. |
| `PUT` | `/displays/:id` | Update display information in OptiSigns and locally. |

#### Tags

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/displays/:id/tags` | Add tags to a display. Body: `{ tags: [] }`. |
| `DELETE` | `/displays/:id/tags` | Remove tags from a display. Body: `{ tags: [] }`. |

#### Takeover

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/displays/:id/takeover` | Temporarily override display content with an asset or playlist. |
| `POST` | `/displays/:id/stop-takeover` | Stop an active takeover for a display. |
| `GET` | `/displays/:id/takeover-status` | Check takeover status for a display. |
| `GET` | `/takeovers` | List active takeovers with pagination. |

### Assets

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/assets/upload` | Upload a new file asset to OptiSigns. |
| `POST` | `/assets/website` | Create a website asset from a URL. |
| `POST` | `/assets/sync` | Synchronize asset list from OptiSigns. |
| `GET`  | `/assets` | List assets stored locally. Supports `type`, `page`, `limit`. |

### Content Push

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `POST` | `/displays/:id/push` | Push content to a display immediately or by schedule. |

---

These APIs are defined in `shared/content-creation-routes.js` and `shared/optisigns-routes.js` and are initialized by the server. Refer to the source for implementation specifics.


