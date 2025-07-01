// tracers-models.js
// Models for the TracersAPI integration system

module.exports = (sequelize, DataTypes) => {
  // Track which tenants have access to TracersAPI
  const TracersAccess = sequelize.define('TracersAccess', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      primaryKey: true
    },
    isEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    dailyLimit: {
      type: DataTypes.INTEGER,
      defaultValue: 100,
      comment: 'Daily search limit for this tenant'
    },
    monthlyLimit: {
      type: DataTypes.INTEGER,
      defaultValue: 1000,
      comment: 'Monthly search limit for this tenant'
    },
    costPerSearch: {
      type: DataTypes.DECIMAL(10, 4),
      defaultValue: 0.25,
      comment: 'Cost charged to tenant per search'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional configuration or notes'
    }
  }, {
    tableName: 'TracersAccess',
    indexes: [
      {
        fields: ['isEnabled']
      }
    ]
  });

  // Track all searches for billing and audit
  const TracersSearch = sequelize.define('TracersSearch', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    leadId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Leads',
        key: 'id'
      }
    },
    searchType: {
      type: DataTypes.ENUM('phone', 'name', 'email', 'address', 'comprehensive'),
      defaultValue: 'phone'
    },
    searchCriteria: {
      type: DataTypes.JSONB,
      allowNull: false,
      comment: 'The search parameters sent to API'
    },
    searchPhone: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Phone number searched (indexed for quick lookups)'
    },
    apiResponse: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Full API response data'
    },
    resultCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    status: {
      type: DataTypes.ENUM('pending', 'success', 'no_results', 'error', 'rate_limited'),
      defaultValue: 'pending'
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    apiCallDuration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'API call duration in milliseconds'
    },
    cost: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      comment: 'Cost of this search'
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'User who initiated the search'
    },
    cacheHit: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Whether this was served from cache'
    },
    enrichmentData: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Extracted enrichment data from response'
    }
  }, {
    tableName: 'TracersSearches',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['leadId']
      },
      {
        fields: ['searchPhone']
      },
      {
        fields: ['status']
      },
      {
        fields: ['createdAt']
      },
      {
        fields: ['tenantId', 'createdAt']
      }
    ]
  });

  // Cache search results to minimize API calls
  const TracersCache = sequelize.define('TracersCache', {
    cacheKey: {
      type: DataTypes.STRING,
      primaryKey: true,
      comment: 'Hash of search criteria'
    },
    searchType: {
      type: DataTypes.STRING,
      allowNull: false
    },
    searchCriteria: {
      type: DataTypes.JSONB,
      allowNull: false
    },
    responseData: {
      type: DataTypes.JSONB,
      allowNull: false
    },
    resultCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    hitCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Number of times this cache entry was used'
    },
    lastAccessedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'TracersCache',
    indexes: [
      {
        fields: ['expiresAt']
      },
      {
        fields: ['searchType']
      },
      {
        fields: ['lastAccessedAt']
      }
    ]
  });

  // Track usage statistics for billing
  const TracersUsage = sequelize.define('TracersUsage', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    searchCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    successfulSearches: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    failedSearches: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    noResultSearches: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    cacheHits: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    totalCost: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00
    },
    searchTypes: {
      type: DataTypes.JSONB,
      defaultValue: {
        phone: 0,
        name: 0,
        email: 0,
        address: 0,
        comprehensive: 0
      }
    },
    peakHour: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Hour with most searches (0-23)'
    },
    uniquePhones: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Number of unique phones searched'
    }
  }, {
    tableName: 'TracersUsage',
    indexes: [
      {
        fields: ['tenantId', 'date'],
        unique: true
      },
      {
        fields: ['date']
      },
      {
        fields: ['tenantId']
      }
    ]
  });

  // Track lead enrichment status
  const LeadEnrichment = sequelize.define('LeadEnrichment', {
    leadId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      references: {
        model: 'Leads',
        key: 'id'
      }
    },
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    lastEnrichedAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    enrichmentSource: {
      type: DataTypes.STRING,
      defaultValue: 'tracers'
    },
    tracersSearchId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'TracersSearches',
        key: 'id'
      }
    },
    enrichedFields: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Which fields were enriched'
    },
    enrichmentData: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'The actual enrichment data'
    },
    confidence: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      comment: 'Confidence score of the match (0-1)'
    },
    status: {
      type: DataTypes.ENUM('enriched', 'no_data', 'error', 'pending'),
      defaultValue: 'pending'
    },
    nextEnrichmentDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When to re-enrich this lead'
    }
  }, {
    tableName: 'LeadEnrichments',
    indexes: [
      {
        fields: ['tenantId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['lastEnrichedAt']
      },
      {
        fields: ['nextEnrichmentDate']
      }
    ]
  });

  // Define relationships
  TracersSearch.belongsTo(sequelize.models.Lead, {
    foreignKey: 'leadId',
    as: 'lead'
  });

  LeadEnrichment.belongsTo(sequelize.models.Lead, {
    foreignKey: 'leadId',
    as: 'lead'
  });

  LeadEnrichment.belongsTo(TracersSearch, {
    foreignKey: 'tracersSearchId',
    as: 'tracersSearch'
  });

  return {
    TracersAccess,
    TracersSearch,
    TracersCache,
    TracersUsage,
    LeadEnrichment
  };
};
