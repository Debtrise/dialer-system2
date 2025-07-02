# PBX API

These endpoints manage connection details for the external PBX used by the dialer. All routes are mounted under `/api` and require Bearer authentication.

## Get Configuration

`GET /pbx/config`

Returns the stored PBX configuration without the password field.

Example response:
```json
{
  "id": 1,
  "serverUrl": "http://pbx.example.com",
  "websocketUrl": "wss://pbx.example.com:8089/ws",
  "username": "1000",
  "domain": "pbx.example.com"
}
```

## Update Configuration

`PUT /pbx/config`

Provide `serverUrl`, `websocketUrl`, `username`, `password` and `domain` in the request body to create or update the PBX settings.

Example request body:
```json
{
  "serverUrl": "http://pbx.example.com",
  "websocketUrl": "wss://pbx.example.com:8089/ws",
  "username": "1000",
  "password": "secret",
  "domain": "pbx.example.com"
}
```

The response is:
```json
{ "message": "PBX configuration saved" }
```

## Example Connection

A client such as [SIP.js](https://sipjs.com/) can use these settings to establish a WebRTC connection:
```javascript
const { websocketUrl, username, domain } = config;
const userAgent = new SIP.UA({
  uri: `sip:${username}@${domain}`,
  transportOptions: { wsServers: [websocketUrl] },
  authorizationUsername: username,
  authorizationPassword: 'your-password'
});
userAgent.start();
```
