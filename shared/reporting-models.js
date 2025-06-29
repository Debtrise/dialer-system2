// reporting-models.js
// Models for comprehensive reporting system with custom report builder

module.exports = (sequelize, DataTypes) => {
  // Report Templates
  const ReportTemplate = sequelize.define('ReportTemplate', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    type: {
      type: DataTypes.ENUM(
        'call_summary',
        'sms_summary',
        'agent_performance',
        'lead_conversion',
        'journey_analytics',
        'campaign_roi',
        'custom',
        'dashboard',
        'lead_gen'
      ),
      allowNull: false
    },
    config: {
      type: DataTypes.JSONB,
      defaultValue: {
        metrics: [],
        groupBy: [],
        filters: {},
        chartType: 'table',
        dateRange: 'last_7_days'
      }
    },
    schedule: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        frequency: 'daily', // daily, weekly, monthly
        time: '09:00',
        recipients: [],
        format: 'pdf' // pdf, csv, excel
      }
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    lastModifiedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  });

  // Report Builder Configuration
  const ReportBuilder = sequelize.define('ReportBuilder', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    layout: {
      type: DataTypes.JSONB,
      defaultValue: {
        type: 'grid', // grid, freeform
        columns: 12,
        rows: 'auto',
        gap: 16,
        responsive: true
      }
    },
    theme: {
      type: DataTypes.JSONB,
      defaultValue: {
        primaryColor: '#3B82F6',
        backgroundColor: '#FFFFFF',
        textColor: '#1F2937',
        borderRadius: 8,
        shadow: 'sm'
      }
    },
    dataSources: {
      type: DataTypes.JSONB,
      defaultValue: []
      // Array of data source configurations
      // [{
      //   id: 'ds1',
      //   type: 'table', // table, query, api
      //   table: 'Leads',
      //   fields: ['id', 'name', 'phone', 'status'],
      //   filters: {},
      //   joins: []
      // }]
    },
    refreshInterval: {
      type: DataTypes.INTEGER,
      defaultValue: 0 // 0 = manual refresh, > 0 = auto refresh in seconds
    },
    isPublic: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    publicToken: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    },
    permissions: {
      type: DataTypes.JSONB,
      defaultValue: {
        view: [],
        edit: [],
        delete: []
      }
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    },
    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    lastModifiedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  });

  // Report Widgets for custom reports
  const ReportWidget = sequelize.define('ReportWidget', {
    reportBuilderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'ReportBuilders',
        key: 'id'
      }
    },
    type: {
      type: DataTypes.ENUM(
        'metric', 'chart', 'table', 'text', 'image', 
        'filter', 'date_picker', 'gauge', 'map', 'timeline'
      ),
      allowNull: false
    },
    title: {
      type: DataTypes.STRING,
      allowNull: true
    },
    position: {
      type: DataTypes.JSONB,
      defaultValue: {
        x: 0,
        y: 0,
        w: 4,
        h: 2
      }
    },
    config: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // Widget-specific configuration
      // For metric: { value: 'COUNT(id)', format: 'number', prefix: '$' }
      // For chart: { type: 'line', xAxis: 'date', yAxis: 'count', series: [] }
      // For table: { columns: [], pageSize: 10, sortable: true }
    },
    dataSource: {
      type: DataTypes.JSONB,
      defaultValue: {
        sourceId: null, // Reference to dataSources in ReportBuilder
        query: null, // Custom query
        aggregation: null, // sum, avg, count, min, max
        groupBy: [],
        orderBy: [],
        limit: null
      }
    },
    styling: {
      type: DataTypes.JSONB,
      defaultValue: {
        backgroundColor: null,
        textColor: null,
        borderColor: null,
        borderWidth: 1,
        padding: 16,
        customCss: null
      }
    },
    interactions: {
      type: DataTypes.JSONB,
      defaultValue: {
        clickable: false,
        drillDown: null,
        tooltip: true,
        exportable: true
      }
    },
    refreshInterval: {
      type: DataTypes.INTEGER,
      defaultValue: null // null = inherit from report, 0 = manual, > 0 = seconds
    },
    isVisible: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    order: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    }
  });

  // Report Data Sources Registry
  const ReportDataSource = sequelize.define('ReportDataSource', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('table', 'view', 'query', 'api', 'function'),
      allowNull: false
    },
    config: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // For table: { tableName: 'Leads', allowedFields: [] }
      // For query: { sql: 'SELECT ...', parameters: [] }
      // For api: { endpoint: '/api/...', method: 'GET', headers: {} }
    },
    schema: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // Field definitions: { fieldName: { type: 'string', label: 'Field Label' } }
    },
    permissions: {
      type: DataTypes.JSONB,
      defaultValue: {
        roles: [],
        users: []
      }
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  // Report Executions
  const ReportExecution = sequelize.define('ReportExecution', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    templateId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    reportBuilderId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
      defaultValue: 'pending'
    },
    parameters: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    results: {
      type: DataTypes.JSONB,
      defaultValue: null
    },
    fileUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    executionTime: {
      type: DataTypes.INTEGER,
      allowNull: true // milliseconds
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    requestedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  });

  // Dashboard Configuration
  const DashboardConfig = sequelize.define('DashboardConfig', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true // null = tenant default
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    layout: {
      type: DataTypes.JSONB,
      defaultValue: []
      // Array of widget configurations
    },
    theme: {
      type: DataTypes.JSONB,
      defaultValue: {
        mode: 'light',
        primaryColor: '#3B82F6'
      }
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    refreshInterval: {
      type: DataTypes.INTEGER,
      defaultValue: 30 // seconds
    }
  });

  // Aggregated Call Statistics (for faster reporting)
  const CallStatistics = sequelize.define('CallStatistics', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    hour: {
      type: DataTypes.INTEGER,
      allowNull: true // 0-23, null for daily aggregates
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    didId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    transferGroupId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    totalCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    answeredCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    missedCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    transferredCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    totalDuration: {
      type: DataTypes.INTEGER,
      defaultValue: 0 // seconds
    },
    avgDuration: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    totalWaitTime: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    avgWaitTime: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    }
  }, {
    indexes: [
      {
        unique: true,
        fields: ['tenantId', 'date', 'hour', 'agentId', 'didId']
      }
    ]
  });

  // Aggregated SMS Statistics
  const SmsStatistics = sequelize.define('SmsStatistics', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    hour: {
      type: DataTypes.INTEGER,
      allowNull: true // 0-23
    },
    fromNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    templateId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    totalSent: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    totalDelivered: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    totalFailed: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    totalInbound: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    totalCost: {
      type: DataTypes.DECIMAL(10, 4),
      defaultValue: 0
    }
  }, {
    indexes: [
      {
        unique: true,
        fields: ['tenantId', 'date', 'hour', 'fromNumber']
      }
    ]
  });

  // Lead Performance Metrics
  const LeadMetrics = sequelize.define('LeadMetrics', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true
    },
    brand: {
      type: DataTypes.STRING,
      allowNull: true
    },
    totalLeads: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    contactedLeads: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    transferredLeads: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    convertedLeads: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    avgContactAttempts: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    avgTimeToContact: {
      type: DataTypes.INTEGER,
      defaultValue: 0 // minutes
    },
    avgTimeToConvert: {
      type: DataTypes.INTEGER,
      defaultValue: 0 // hours
    }
  }, {
    indexes: [
      {
        unique: true,
        fields: ['tenantId', 'date', 'source', 'brand']
      }
    ]
  });

  // Journey Analytics
  const JourneyAnalytics = sequelize.define('JourneyAnalytics', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    journeyId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    totalEnrollments: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    activeEnrollments: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    completedEnrollments: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    exitedEnrollments: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    stepMetrics: {
      type: DataTypes.JSONB,
      defaultValue: {}
      // Format: { stepId: { executions, successes, failures, avgDuration } }
    },
    conversionRate: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    avgCompletionTime: {
      type: DataTypes.INTEGER,
      defaultValue: 0 // hours
    }
  }, {
    indexes: [
      {
        unique: true,
        fields: ['tenantId', 'journeyId', 'date']
      }
    ]
  });

  // Lead Generation Metrics
  const LeadGenMetrics = sequelize.define('LeadGenMetrics', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    channel: {
      type: DataTypes.STRING,
      allowNull: true
    },
    campaign: {
      type: DataTypes.STRING,
      allowNull: true
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true
    },
    totalLeads: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    qualifiedLeads: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    cost: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    revenue: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    conversionRate: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    costPerLead: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    roi: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    },
    qualityScore: {
      type: DataTypes.FLOAT,
      defaultValue: 0
    }
  }, {
    indexes: [
      {
        unique: true,
        fields: ['tenantId', 'date', 'channel', 'campaign', 'source']
      }
    ]
  });

  // Custom Metrics (for extensibility)
  const CustomMetric = sequelize.define('CustomMetric', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    dimensions: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    metrics: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  });

  // Real-time Dashboard Stats
  const DashboardSnapshot = sequelize.define('DashboardSnapshot', {
    tenantId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    stats: {
      type: DataTypes.JSONB,
      defaultValue: {
        activeCalls: 0,
        waitingCalls: 0,
        availableAgents: 0,
        busyAgents: 0,
        todaysCalls: 0,
        todaysSms: 0,
        todaysLeads: 0,
        activeJourneys: 0,
        leadConversionRate: 0,
        avgResponseTime: 0
      }
    },
    alerts: {
      type: DataTypes.JSONB,
      defaultValue: []
    }
  }, {
    indexes: [
      {
        fields: ['tenantId', 'timestamp']
      }
    ]
  });

  // Define relationships
  ReportExecution.belongsTo(ReportTemplate, { foreignKey: 'templateId' });
  ReportTemplate.hasMany(ReportExecution, { foreignKey: 'templateId' });

  ReportBuilder.hasMany(ReportWidget, { 
    foreignKey: 'reportBuilderId',
    as: 'widgets',
    onDelete: 'CASCADE'
  });
  ReportWidget.belongsTo(ReportBuilder, { 
    foreignKey: 'reportBuilderId'
  });

  ReportExecution.belongsTo(ReportBuilder, { foreignKey: 'reportBuilderId' });
  ReportBuilder.hasMany(ReportExecution, { foreignKey: 'reportBuilderId' });

  return {
    ReportTemplate,
    ReportBuilder,
    ReportWidget,
    ReportDataSource,
    ReportExecution,
    DashboardConfig,
    CallStatistics,
    SmsStatistics,
    LeadMetrics,
    JourneyAnalytics,
    LeadGenMetrics,
    CustomMetric,
    DashboardSnapshot
  };
};