#!/bin/bash

# Fix all tenantId comparisons in reporting-service.js

# First, ensure all tenant.id references are converted to strings
sed -i 's/tenantId: tenant\.id,/tenantId: String(tenant.id),/g' reporting-service.js
sed -i 's/tenantId: tenant\.id$/tenantId: String(tenant.id)/g' reporting-service.js
sed -i 's/tenantId: tenantId/tenantId: String(tenantId)/g' reporting-service.js

# Fix specific patterns where tenantId is used in where clauses
sed -i 's/where: { tenantId: \([^}]*\) }/where: { tenantId: String(\1) }/g' reporting-service.js

# Fix the specific line causing the issue (around line 1064)
sed -i '/updateDashboardStats/,/^[[:space:]]*}/ s/tenantId: tenant\.id/tenantId: String(tenant.id)/g' reporting-service.js

echo "Fixed reporting-service.js"
