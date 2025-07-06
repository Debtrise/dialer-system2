# Common Data Schemas

The services in this repository expose similar JSON objects for OptiSigns displays,
content templates, projects and sales representative photos. All properties use
`camelCase` naming to keep the APIs consistent.

## Display
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

## Template / Project
```json
{
  "id": "uuid",
  "tenantId": "string",
  "name": "string",
  "description": "string",
  "canvasSize": {"width": 1920, "height": 1080},
  "projectData": {},
  "variables": {}
}
```

## Sales Rep Photo Asset
Uploaded photos are treated as normal content assets. The original file is kept
in `uploads/content/sales-rep-photos` while thumbnails and previews are stored in
`uploads/content/sales-rep-thumbnails` and `uploads/content/sales-rep-previews`.
