#!/bin/bash

# OptiSigns Fixed API Test Script
# Test the corrected GraphQL queries and authentication

# Configuration
API_BASE_URL="http://localhost:3001"
USERNAME="admin"
PASSWORD="admin123"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

make_api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local auth_header="$4"
    
    if [ -n "$data" ]; then
        response=$(curl -s -X "$method" \
            "$API_BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            ${auth_header:+-H "Authorization: Bearer $auth_header"} \
            -d "$data" \
            -w "\nHTTP_STATUS:%{http_code}")
    else
        response=$(curl -s -X "$method" \
            "$API_BASE_URL$endpoint" \
            ${auth_header:+-H "Authorization: Bearer $auth_header"} \
            -w "\nHTTP_STATUS:%{http_code}")
    fi
    
    http_status=$(echo "$response" | tail -n1 | sed 's/HTTP_STATUS://')
    response_body=$(echo "$response" | sed '$d')
    
    echo "$http_status|$response_body"
}

extract_token() {
    local response="$1"
    echo "$response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4
}

echo "=============================================================="
echo "🔧 OptiSigns Fixed API Test"
echo "✅ Testing corrected GraphQL queries and Bearer auth"
echo "=============================================================="

# Step 1: Login
print_status "Step 1: Authenticating..."
login_result=$(make_api_call "POST" "/api/login" '{"username":"'$USERNAME'","password":"'$PASSWORD'"}' "")
login_status=$(echo "$login_result" | cut -d'|' -f1)
login_response=$(echo "$login_result" | cut -d'|' -f2-)

if [ "$login_status" = "200" ]; then
    JWT_TOKEN=$(extract_token "$login_response")
    print_success "✅ Authenticated successfully"
else
    print_error "❌ Login failed"
    exit 1
fi

# Step 2: Test API connection with corrected query
print_status "Step 2: Testing API connection (corrected 'id' field)..."
test_data='{"apiToken":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ4RGRuREpOdXVQMmJEb2pudyIsImNpZCI6Ilk2S0QyeUpjZ1hRZjZOU2JvIiwiYWlkIjoicWh6UjRDUXlrTGRKd0RibjgiLCJpYXQiOjE3NTA0NDcyMTMsImV4cCI6MTc1MDQ1MDgxMywiaXNzIjoicWh6UjRDUXlrTGRKd0RibjgifQ.zWYHOHFFtZ7xaNDlUP88sUAFRFYOgMgv-g11532DmHAjIV0uTJR91i_VAJNsCGLBIRYpfdmAxrL1Mwzh3cj69Mj-1EN1oEuiGQpwVExDCzAgb2tyO49UWV4X7RjaCizwPdOLweKZ-UXWBKX4rImGQDrd6TWl4hIOUuY4NnAk-JlULwnMIo3VKrYKsCzTXaPSjXPWkTsnQMTt8d6QAr024Owgy3numT_vdv3waZ_PPTKxhrR3hNRIGijjJaki0URk8TMWo3Ji-xVZ3rmJxS5d1G-9Mj2RIQuJTH-a41Cz-_X6uZJRe6OSaxf_9BoYxgK2AxalaTKrFXAp7tNDSraA1YvHjb8GqH-jtIDi_Q1mWPLlWSVHKYrdRsbpWPqmLOQQFhUgCgBHxE54ic8vlNFcXwtFHl-5TC29zXQCyZNvAQNm-i-VCeC_4UbhrEDhgtemPHZw7Yc4L-4rKlIbvno-1dZasaDzHwLaK6t4ym97I2UtmQWsSl6qXV_yegapNcbQL_Y4PoG14Qavy3FI3h2iOZSncGM22Ca6wbuPaKKdhAO2wBGQsOs4n4Cg-4_hODNKCHRc18qvCQK5gBqd0aeUYQ98p7c85G57rLE3SK1fDyaXCAHFYZKdgUUUFcVTOCzoaMyYIqh_-p6sHYLR_Y9sOWkjSDl7yBZSNERIxq73uXQ"}'

test_result=$(make_api_call "POST" "/api/optisigns/config/test" "$test_data" "$JWT_TOKEN")
test_status=$(echo "$test_result" | cut -d'|' -f1)
test_body=$(echo "$test_result" | cut -d'|' -f2-)

if [ "$test_status" = "200" ]; then
    print_success "✅ API connection test successful!"
    echo "Response: $test_body"
    
    # Configure the API key
    print_status "Step 3: Configuring API token..."
    config_data='{"apiToken":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ4RGRuREpOdXVQMmJEb2pudyIsImNpZCI6Ilk2S0QyeUpjZ1hRZjZOU2JvIiwiYWlkIjoicWh6UjRDUXlrTGRKd0RibjgiLCJpYXQiOjE3NTA0NDcyMTMsImV4cCI6MTc1MDQ1MDgxMywiaXNzIjoicWh6UjRDUXlrTGRKd0RibjgifQ.zWYHOHFFtZ7xaNDlUP88sUAFRFYOgMgv-g11532DmHAjIV0uTJR91i_VAJNsCGLBIRYpfdmAxrL1Mwzh3cj69Mj-1EN1oEuiGQpwVExDCzAgb2tyO49UWV4X7RjaCizwPdOLweKZ-UXWBKX4rImGQDrd6TWl4hIOUuY4NnAk-JlULwnMIo3VKrYKsCzTXaPSjXPWkTsnQMTt8d6QAr024Owgy3numT_vdv3waZ_PPTKxhrR3hNRIGijjJaki0URk8TMWo3Ji-xVZ3rmJxS5d1G-9Mj2RIQuJTH-a41Cz-_X6uZJRe6OSaxf_9BoYxgK2AxalaTKrFXAp7tNDSraA1YvHjb8GqH-jtIDi_Q1mWPLlWSVHKYrdRsbpWPqmLOQQFhUgCgBHxE54ic8vlNFcXwtFHl-5TC29zXQCyZNvAQNm-i-VCeC_4UbhrEDhgtemPHZw7Yc4L-4rKlIbvno-1dZasaDzHwLaK6t4ym97I2UtmQWsSl6qXV_yegapNcbQL_Y4PoG14Qavy3FI3h2iOZSncGM22Ca6wbuPaKKdhAO2wBGQsOs4n4Cg-4_hODNKCHRc18qvCQK5gBqd0aeUYQ98p7c85G57rLE3SK1fDyaXCAHFYZKdgUUUFcVTOCzoaMyYIqh_-p6sHYLR_Y9sOWkjSDl7yBZSNERIxq73uXQ","settings":{"autoSync":true}}'
    
    config_result=$(make_api_call "PUT" "/api/optisigns/config" "$config_data" "$JWT_TOKEN")
    config_status=$(echo "$config_result" | cut -d'|' -f1)
    
    if [ "$config_status" = "200" ]; then
        print_success "✅ API token configured successfully!"
        
        # Step 4: Test device sync with corrected queries
        print_status "Step 4: Testing device sync (with corrected GraphQL)..."
        
        sync_result=$(make_api_call "POST" "/api/optisigns/displays/sync" "" "$JWT_TOKEN")
        sync_status=$(echo "$sync_result" | cut -d'|' -f1)
        sync_body=$(echo "$sync_result" | cut -d'|' -f2-)
        
        if [ "$sync_status" = "200" ]; then
            print_success "🎉 Device sync successful! GraphQL queries are working!"
            echo "Sync result: $sync_body"
        else
            print_error "Device sync failed with status: $sync_status"
            echo "Response: $sync_body"
            echo ""
            echo "This indicates GraphQL query structure still needs adjustment"
        fi
        
        # Step 5: Test asset sync
        print_status "Step 5: Testing asset sync..."
        
        assets_result=$(make_api_call "POST" "/api/optisigns/assets/sync" "" "$JWT_TOKEN")
        assets_status=$(echo "$assets_result" | cut -d'|' -f1)
        
        if [ "$assets_status" = "200" ]; then
            print_success "✅ Asset sync successful!"
        else
            print_error "Asset sync failed with status: $assets_status"
        fi
        
        # Step 6: Test analytics
        print_status "Step 6: Testing analytics..."
        
        analytics_result=$(make_api_call "GET" "/api/optisigns/analytics" "" "$JWT_TOKEN")
        analytics_status=$(echo "$analytics_result" | cut -d'|' -f1)
        
        if [ "$analytics_status" = "200" ]; then
            print_success "✅ Analytics working!"
        else
            print_error "Analytics failed with status: $analytics_status"
        fi
        
    else
        print_error "Configuration failed with status: $config_status"
    fi
    
else
    print_error "❌ API connection test failed with status: $test_status"
    echo "Response: $test_body"
    echo ""
    echo "Possible issues:"
    echo "  1. API token expired or invalid"
    echo "  2. GraphQL query structure still incorrect" 
    echo "  3. Authorization format issue"
fi

echo ""
echo "=============================================================="
echo "📊 FIXED API TEST SUMMARY"
echo "=============================================================="
echo "🔐 API Connection: $( [ "$test_status" = "200" ] && echo "✅ Working" || echo "❌ Failed" )"
echo "⚙️  Configuration: $( [ "$config_status" = "200" ] && echo "✅ Working" || echo "❌ Failed" )"
echo "📺 Device Sync: $( [ "$sync_status" = "200" ] && echo "✅ Working" || echo "❌ Still needs GraphQL fixes" )"
echo "🎨 Asset Sync: $( [ "$assets_status" = "200" ] && echo "✅ Working" || echo "❌ Failed" )"
echo "📊 Analytics: $( [ "$analytics_status" = "200" ] && echo "✅ Working" || echo "❌ Failed" )"
echo "=============================================================="

if [ "$test_status" = "200" ] && [ "$config_status" = "200" ] && [ "$sync_status" = "200" ]; then
    print_success "🎉 All systems working! OptiSigns integration is ready!"
elif [ "$test_status" = "200" ] && [ "$config_status" = "200" ]; then
    print_success "✅ Authentication and config working!"
    echo "⚠️  GraphQL queries may need more adjustment - check server logs"
else
    print_error "❌ Basic integration still has issues"
    echo "💡 Check the server logs for detailed GraphQL error messages"
fi
unset JWT_TOKEN
