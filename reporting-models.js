// reporting-models.js
// Models for comprehensive reporting system

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
        'custom'
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
        activeJourneys: 0
      }
    }
  });

  // Define indexes for performance
  CallStatistics.addIndex(['tenantId', 'date']);
  CallStatistics.addIndex(['tenantId', 'date', 'hour']);
  CallStatistics.addIndex(['tenantId', 'agentId', 'date']);
  
  SmsStatistics.addIndex(['tenantId', 'date']);
  SmsStatistics.addIndex(['tenantId', 'date', 'hour']);
  
  LeadMetrics.addIndex(['tenantId', 'date']);
  LeadMetrics.addIndex(['tenantId', 'source', 'date']);
  LeadMetrics.addIndex(['tenantId', 'brand', 'date']);
  
  JourneyAnalytics.addIndex(['tenantId', 'journeyId', 'date']);
  CustomMetric.addIndex(['tenantId', 'category', 'date']);

  // Relationships
  ReportExecution.belongsTo(ReportTemplate, { foreignKey: 'templateId' });
  ReportTemplate.hasMany(ReportExecution, { foreignKey: 'templateId' });

  return {
    ReportTemplate,
    ReportExecution,
    CallStatistics,
    SmsStatistics,
    LeadMetrics,
    JourneyAnalytics,
    CustomMetric,
    DashboardSnapshot
  };
};
