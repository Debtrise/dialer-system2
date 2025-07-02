# User Management API

These endpoints allow administrators to manage user roles and permissions.
All routes are prefixed with `/api` and require Bearer authentication.

## Update Role and Permissions

`PUT /users/:id/role-permissions`

Update a user's `role` and `permissions` in one request. Only admins can call this endpoint.
The request body can include:

```json
{
  "role": "agent",
  "permissions": {"dialer": true}
}
```

The response returns the updated user object excluding the password.
