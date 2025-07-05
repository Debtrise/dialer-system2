#!/bin/bash
# announcement-test.sh - Test Sales Rep Photo Announcement workflow
# Requires: jq, curl

set -e

API_BASE_URL="http://localhost:3001/api"
USERNAME="admin"
PASSWORD="admin123"

REP_EMAIL="rep@example.com"
REP_NAME="Test Rep"
PHOTO_FILE="sample.jpg"
DISPLAY_NAME="KASH office"
WEBHOOK_NAME="Sales Rep Announcement Test"

# Function to log steps
echo_step() {
  echo -e "\n=== $1 ==="
}

# 1. Authenticate and get JWT token
echo_step "Authenticating"
TOKEN=$(curl -s -X POST "$API_BASE_URL/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"'$USERNAME'","password":"'$PASSWORD'"}' | jq -r '.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "Authentication failed" && exit 1
fi

echo "Token acquired"

# 2. Upload sales rep photo
if [ ! -f "$PHOTO_FILE" ]; then
  echo "Photo file $PHOTO_FILE not found" && exit 1
fi

echo_step "Uploading sales rep photo"
UPLOAD_RES=$(curl -s -X POST "$API_BASE_URL/sales-rep-photos/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "photo=@$PHOTO_FILE" \
  -F "repEmail=$REP_EMAIL" \
  -F "repName=$REP_NAME")
PHOTO_ID=$(echo "$UPLOAD_RES" | jq -r '.id')

echo "Photo uploaded with ID: $PHOTO_ID"

# 3. Search photo by email
echo_step "Retrieving photo by email"
curl -s -X GET "$API_BASE_URL/sales-rep-photos/by-email/$REP_EMAIL" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 4. Create announcement project
echo_step "Creating announcement project"
read -r -d '' PROJECT_PAYLOAD <<JSON
{
  "name": "Announcement Test",
  "description": "Test project with sales rep photo",
  "category": "announcement",
  "projectData": {"elements": {}},
  "variables": {"rep_photo":"","rep_name":"","rep_email":"","deal_amount":"","company_name":""}
}
JSON

PROJECT_ID=$(curl -s -X POST "$API_BASE_URL/content/projects" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PROJECT_PAYLOAD" | jq -r '.project.id')

echo "Project created: $PROJECT_ID"

# Add sales rep photo element
echo_step "Adding sales rep photo element"
read -r -d '' ELEMENT_PAYLOAD <<JSON
{
  "elementType": "sales_rep_photo",
  "name": "Rep Photo",
  "position": {"x": 960, "y": 540, "z": 1},
  "size": {"width": 400, "height": 400},
  "properties": {"src": "{rep_photo}", "fit": "cover"}
}
JSON

curl -s -X POST "$API_BASE_URL/content/projects/$PROJECT_ID/elements" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$ELEMENT_PAYLOAD" | jq .

echo_step "Finding display ID for '$DISPLAY_NAME'"
DISPLAY_ID=$(curl -s -X GET "$API_BASE_URL/optisigns/displays?limit=100" \
  -H "Authorization: Bearer $TOKEN" | jq -r --arg name "$DISPLAY_NAME" '.displays[] | select(.name==$name) | .id')

if [ -z "$DISPLAY_ID" ]; then
  echo "Display '$DISPLAY_NAME' not found" && exit 1
fi

echo "Display ID: $DISPLAY_ID"

# 5. Create announcement webhook
echo_step "Creating webhook"
read -r -d '' WEBHOOK_PAYLOAD <<JSON
{
  "name": "$WEBHOOK_NAME",
  "webhookType": "announcement",
  "announcementConfig": {
    "enabled": true,
    "contentCreator": {
      "projectId": "$PROJECT_ID",
      "generateNewContent": false,
      "variableMapping": {
        "rep_name": "salesRep.name",
        "rep_email": "salesRep.email",
        "deal_amount": "deal.amount",
        "company_name": "client.company"
      },
      "projectSettings": {"name": "Deal Closed - {rep_name}"}
    },
    "optisigns": {
      "displaySelection": {"mode": "specific", "displayIds": ["$DISPLAY_ID"]},
      "takeover": {"priority": "HIGH", "duration": 30}
    }
  }
}
JSON

WEBHOOK_RES=$(curl -s -X POST "$API_BASE_URL/webhooks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$WEBHOOK_PAYLOAD")
ENDPOINT_KEY=$(echo "$WEBHOOK_RES" | jq -r '.endpointKey')

echo "Webhook created with endpoint key: $ENDPOINT_KEY"

# 6. Trigger webhook to push content
echo_step "Triggering webhook"
read -r -d '' TRIGGER_PAYLOAD <<JSON
{
  "salesRep": {"name": "$REP_NAME", "email": "$REP_EMAIL"},
  "deal": {"amount": "$10,000"},
  "client": {"company": "Test Corp"}
}
JSON

curl -s -X POST "$API_BASE_URL/webhook-receiver/$ENDPOINT_KEY" \
  -H "Content-Type: application/json" \
  -d "$TRIGGER_PAYLOAD" | jq .

echo "\nAnnouncement triggered. Check OptiSigns display '$DISPLAY_NAME'."
