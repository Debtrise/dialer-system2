# Lead Stage Management API

These endpoints allow you to manage lead stages and assign stages to contacts. All routes require Bearer authentication and are prefixed with `/api`.

## Stage CRUD

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/stages` | List stages for the current tenant. |
| `POST` | `/stages` | Create a new stage. Body should include `title` and optional `catalysts`. |
| `PUT` | `/stages/:id` | Update a stage. |
| `DELETE` | `/stages/:id` | Remove a stage. |

`catalysts` is a free-form JSON array describing typical triggers that move a lead into the stage. Elements may contain dynamic variables used elsewhere in the system.

## Assigning a Lead Stage

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `PUT` | `/leads/:id/stage` | Set the stage for a single lead. Body: `{ "stageId": 2 }`. |

