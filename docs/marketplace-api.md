# Lead Marketplace API

This module exposes endpoints for buying and selling leads. All routes are mounted under `/api` and require authentication.

## Create Provider
`POST /marketplace/providers`
Payload:
```json
{
  "name": "Lead Seller",
  "description": "Quality solar leads",
  "contact": { "email": "seller@example.com" }
}
```

## List Providers
`GET /marketplace/providers`

## Create Listing
`POST /marketplace/listings`
```json
{
  "providerId": 1,
  "name": "Solar Leads",
  "pricePerLead": 5.00,
  "deliveryMethod": "csv",
  "availableLeads": 100
}
```

## List Listings
`GET /marketplace/listings`

## Purchase Leads
`POST /marketplace/listings/:id/purchase`
```json
{
  "quantity": 10
}
```

## List Orders
`GET /marketplace/orders`

## Update Order Performance
`POST /marketplace/orders/:orderId/performance`
```json
{
  "closedLeads": 5
}
```

## Provider Analytics
`GET /marketplace/providers/:providerId/analytics`
Returns overall close rates and buyer breakdown for a lead provider.
