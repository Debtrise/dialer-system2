# Marketing Service API

The marketing service allows linking advertising accounts and tracking campaign metrics.
All routes are mounted under `/api` and require authentication.

## Link an Ad Account
`POST /marketing/accounts`
```json
{
  "platform": "facebook",
  "accountId": "123",
  "tokens": { "accessToken": "token" }
}
```

## List Accounts
`GET /marketing/accounts`

## Create Campaign
`POST /marketing/campaigns`
```json
{
  "adAccountId": 1,
  "data": {
    "externalId": "abc",
    "name": "My Campaign",
    "cost": 100
  }
}
```

## Get Campaign Metrics
`GET /marketing/campaigns/:id/metrics`

## Record Lead
`POST /marketing/campaigns/:id/leads`
```json
{
  "leadId": 42,
  "externalLeadId": "abc123",
  "data": { "source": "facebook" }
}
```
Creates a marketing lead entry, attaches marketing info to the lead and triggers a webhook event.
