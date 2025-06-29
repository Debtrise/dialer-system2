#!/bin/bash

# OptiSigns API Diagnostic Script
# This will help us figure out the correct GraphQL structure and auth format

# Configuration
API_BASE_URL="http://34.122.156.88:3001"
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

# Function to test GraphQL directly
test_graphql_direct() {
    local query="$1"
    local auth_format="$2"
    local token="$3"
    
    curl -s -X POST \
        "https://graphql-gateway.optisigns.com/graphql" \
        -H "Authorization: $auth_format $token" \
        -H "Content-Type: application/json" \
        -d "{\"query\":\"$query\"}" \
        -w "\nHTTP_STATUS:%{http_code}"
}

echo "=============================================================="
echo "🔍 OptiSigns API Diagnostic Tool"
echo "🎯 Finding correct GraphQL structure and auth format"
echo "=============================================================="

# Step 1: Login to get JWT
print_status "Step 1: Getting authentication token..."
login_result=$(make_api_call "POST" "/api/login" '{"username":"'$USERNAME'","password":"'$PASSWORD'"}' "")
login_status=$(echo "$login_result" | cut -d'|' -f1)
login_response=$(echo "$login_result" | cut -d'|' -f2-)

if [ "$login_status" = "200" ]; then
    JWT_TOKEN=$(extract_token "$login_response")
    print_success "✅ Got JWT token"
else
    print_error "❌ Login failed"
    exit 1
fi

# Step 2: Check if OptiSigns is configured
print_status "Step 2: Checking OptiSigns configuration..."
config_result=$(make_api_call "GET" "/api/optisigns/config" "" "$JWT_TOKEN")
config_status=$(echo "$config_result" | cut -d'|' -f1)
config_body=$(echo "$config_result" | cut -d'|' -f2-)

# Extract the masked API token to get the real one
# This is a hack - in production you'd store the token separately
OPTISIGNS_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJyM0NTQ2RLUWhTUFF6R0RwTiIsImNpZCI6Ik5hcXRxOVQ5Nm5QSFk2YjVaIiwiYWlkIjoicWh6UjRDUXlrTGRKd0RibjgiLCJpYXQiOjE3NTA2MjczMjEsImV4cCI6MTc1MDYzMDkyMSwiaXNzIjoicWh6UjRDUXlrTGRKd0RibjgifQ.qPFba1uihTQnSW4GI_qOOOtEKSFBm_P6AyegImqpOJa0Ry8TeFlKclRSUxF_IXLwx2Hw7LWaMRFklRPRzIyYfnFI2d-ORrAs0FjmHGV7REAFfAQoX6wscc86GCZ_qJHnekgGImV44kipeTM3VTZcOTKoRIN415VBXRueKAFoybkphv8lKQRFhUuOKPG4rmeZRpW1o-0hX7uUXlgn1_piC961S_-LtxN7gIa1jFcwJsw7JK4ptIEYXpApR4rrg9X-4T679EzJFZovSxOXhi6KNpBlTAnsfiMT09OWckbX7G5Ptrt7xyMPZuL2cA7MiqX7-PIzo0ZaLGPgZnA-IrytO29dgdOD3Ebq55zrOwXz1Dqfz_Xx79ryB1IRKo5zBsAUNzUe53SSMOpKHXo6k1Rf7hmXv7kMCn4jB6GRd9StnL7EzEkuxbDF_nZIfgpuP1__GWOWMKc_LNRfl0zrqWp2aUGo3TCJLXDGwQfmWkPwSDmmakBqt57AVPNDkHyEBWwOWAZC3Lb4IeeRoGH3VWvswoc_9iyP_N1OMVMIgTYi79f1QgdQDEUoBCxGXranB1efgIRaCprsh6xBlUF9hTadZOOGE0Lhsm8ob6W4c7vsJq-7Fbmm8o0B_0csWTf_FK5NVsaq6iQYIOHFiuUjIUNukvwWmbW_Z51IUA3bRVS0Xt0"

print_status "Step 3: Testing direct GraphQL API with different auth formats..."

# Test different auth formats
AUTH_FORMATS=("Bearer" "" "JWT" "Token")
TEST_QUERIES=(
    "query { me { id email } }"
    "query { __schema { types { name } } }"
    "query { devices }"
)

for auth_format in "${AUTH_FORMATS[@]}"; do
    echo ""
    print_status "Testing auth format: '$auth_format'"
    
    for query in "${TEST_QUERIES[@]}"; do
        echo "  🧪 Testing query: ${query:0:30}..."
        
        if [ -z "$auth_format" ]; then
            # No prefix
            result=$(test_graphql_direct "$query" "" "$OPTISIGNS_TOKEN")
        else
            # With prefix
            result=$(test_graphql_direct "$query" "$auth_format" "$OPTISIGNS_TOKEN")
        fi
        
        status=$(echo "$result" | tail -n1 | sed 's/HTTP_STATUS://')
        body=$(echo "$result" | sed '$d')
        
        if [ "$status" = "200" ]; then
            # Check if response has errors
            if echo "$body" | grep -q '"errors"'; then
                echo "    ❌ Status 200 but has GraphQL errors"
                echo "$body" | jq '.errors[0].message' 2>/dev/null || echo "$body"
            else
                echo "    ✅ SUCCESS! Auth format '$auth_format' works"
                echo "    📋 Response preview:"
                echo "$body" | jq '.' 2>/dev/null | head -10 || echo "$body" | head -3
                
                # Save the working format
                WORKING_AUTH="$auth_format"
                WORKING_QUERY="$query"
                break 2
            fi
        else
            echo "    ❌ HTTP $status"
        fi
    done
done

if [ -n "$WORKING_AUTH" ]; then
    echo ""
    print_success "🎉 Found working configuration!"
    echo "✅ Auth format: '$WORKING_AUTH'"
    echo "✅ Working query: $WORKING_QUERY"
    
    # Now try to discover the schema
    print_status "Step 4: Discovering available queries..."
    
    schema_query='query { __schema { queryType { fields { name args { name type { name } } } } } }'
    
    if [ -z "$WORKING_AUTH" ]; then
        schema_result=$(test_graphql_direct "$schema_query" "" "$OPTISIGNS_TOKEN")
    else
        schema_result=$(test_graphql_direct "$schema_query" "$WORKING_AUTH" "$OPTISIGNS_TOKEN")
    fi
    
    schema_status=$(echo "$schema_result" | tail -n1 | sed 's/HTTP_STATUS://')
    schema_body=$(echo "$schema_result" | sed '$d')
    
    if [ "$schema_status" = "200" ]; then
        print_success "📋 Available GraphQL queries:"
        echo "$schema_body" | jq '.data.__schema.queryType.fields[] | "\(.name)(\(.args | map("\(.name): \(.type.name)") | join(", ")))"' 2>/dev/null || echo "Could not parse schema"
    fi
    
else
    print_error "❌ No working auth format found"
    echo "🔍 This suggests the API token might be invalid or expired"
fi

echo ""
echo "=============================================================="
echo "📊 DIAGNOSTIC SUMMARY"
echo "=============================================================="
echo "🔐 Working Auth Format: ${WORKING_AUTH:-'None found'}"
echo "📝 Working Query: ${WORKING_QUERY:-'None found'}"
echo "🎯 Next Steps:"
echo "   1. Update the service to use the working auth format"
echo "   2. Use the discovered query structure"
echo "   3. Check if the API token needs renewal"
echo "=============================================================="
