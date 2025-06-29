// Add this at the top of reporting-service.js after the imports

// Helper function to ensure tenantId is always a string
const ensureTenantIdString = (tenantId) => {
    return tenantId ? String(tenantId) : null;
};

// Then in the updateDashboardStats method, use:
// tenantId = ensureTenantIdString(tenantId);
