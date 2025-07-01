# Content Creator API

This document describes the HTTP endpoints exposed by the Content Creation service. All authenticated routes require a valid JWT via the `Authorization: Bearer <token>` header.

## Public OptiSync Endpoints
These endpoints are primarily used by OptiSigns to pull content from the system.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/content/optisync/projects/:projectId/feed` | Generate OptiSync data feed for a project. |
| `GET` | `/api/content/optisync/projects` | List projects available for OptiSync. |
| `POST` | `/api/content/optisync/projects/:projectId/webhook` | Notify the system of updates. |
| `GET` | `/api/content/public/:exportId` | Serve exported content for anonymous access. |
| `GET` | `/api/content/optisync/status` | Check OptiSync integration status. |

## Template Endpoints
Manage templates for reusable layouts.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/content/templates` | List templates with optional filters. |
| `GET` | `/api/content/templates/:templateId` | Retrieve a single template. |
| `POST` | `/api/content/templates` | Create a new template. |

## Project Endpoints
Projects contain elements that make up a piece of content.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/content/projects` | List projects with filters. |
| `POST` | `/api/content/projects` | Create a new project. |
| `GET` | `/api/content/projects/:projectId` | Retrieve a project including elements. |
| `PUT` | `/api/content/projects/:projectId` | Update a project. |
| `DELETE` | `/api/content/projects/:projectId` | Remove a project. |
| `POST` | `/api/content/projects/:projectId/elements` | Add an element to a project. |
| `PUT` | `/api/content/projects/:projectId/elements/:elementId` | Update an element. |
| `DELETE` | `/api/content/projects/:projectId/elements/:elementId` | Delete an element. |
| `PUT` | `/api/content/projects/:projectId/elements/reorder` | Reorder elements inside a project. |

## Asset Endpoints
Upload and manage assets used by elements.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/content/assets` | List uploaded assets. |
| `POST` | `/api/content/assets/upload` | Upload a new asset file. |
| `DELETE` | `/api/content/assets/:assetId` | Remove an asset. |

### Sales Rep Photo Element
Templates can include an element with `elementType: "sales_rep_photo"`. When a project is generated from a webhook, the system automatically fills the element's `src` with the sales representative's photo based on the `{rep_photo}` variable.

### Video Backgrounds
Projects may define `canvasBackground.type: "video"` with a `url` to a video asset. When exported, the video is embedded in the generated HTML as a looping, muted element behind all other content.

## Variables and Exporting

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/content/variables` | List user variables. |
| `POST` | `/api/content/variables` | Create or update a variable. |
| `POST` | `/api/content/variables/initialize-system` | Create built‑in variables for a new tenant. |
| `POST` | `/api/content/projects/:projectId/preview` | Generate a preview HTML page. |
| `POST` | `/api/content/projects/:projectId/publish` | Export a project and make it public. |
| `GET` | `/api/content/exports/:exportId/status` | Check export processing status. |
| `GET` | `/api/content/system/status` | Service health check. |

