// reporting-routes.js
// API routes for comprehensive reporting with enhanced dashboard and custom report builder

const express = require('express');
const moment = require('moment-timezone');
const path = require('path');
const cron = require('node-cron');

module.exports = function(app, sequelize, authenticateToken) {
  const { DataTypes, Op } = require('sequelize');
  const router = express.Router();
  const ReportingService = require('./reporting-service'); 
  
  // Initialize all reporting models
  const reportingModels = require('./reporting-models')(sequelize, DataTypes);
  
  // Get existing models from sequelize
  const models = {
    ...sequelize.models,
    ...reportingModels
  };
  
  // Initialize services with BOTH models and sequelize parameters
  const reportingService = new ReportingService({
    ...reportingModels,
    Lead: sequelize.models.Lead,
    CallLog: sequelize.models.CallLog,
    Journey: sequelize.models.Journey,
    JourneyStep: sequelize.models.JourneyStep,     // Add missing model
    LeadJourney: sequelize.models.LeadJourney,
    JourneyExecution: sequelize.models.JourneyExecution, // Add missing model
    Tenant: sequelize.models.Tenant,
    SmsMessage: sequelize.models.SmsMessage,
    Template: sequelize.models.Template,           // Add Template model
    User: sequelize.models.User                    // Add User model for agent reports
  }, sequelize); // THIS IS THE FIX - Pass sequelize as second parameter

  // ===== Dashboard Routes =====
  
  // Get real-time dashboard statistics
  router.get('/dashboard/live-stats', authenticateToken, async (req, res) => {
    try {
      const stats = await reportingService.getDashboardLiveStats(req.user.tenantId);
      res.json(stats);
    } catch (error) {
      console.error('Error getting dashboard live stats:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get historical dashboard data
  router.get('/dashboard/historical', authenticateToken, async (req, res) => {
    try {
      const data = await reportingService.getDashboardHistoricalData(
        req.user.tenantId,
        req.query
      );
      res.json(data);
    } catch (error) {
      console.error('Error getting dashboard historical data:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get dashboard configuration
  router.get('/dashboard/config', authenticateToken, async (req, res) => {
    try {
      const config = await models.DashboardConfig.findOne({
        where: {
          tenantId: req.user.tenantId.toString(),
          userId: req.user.id
        }
      });
      
      if (!config) {
        // Return default config
        return res.json({
          layout: [],
          theme: { mode: 'light', primaryColor: '#3B82F6' },
          refreshInterval: 30
        });
      }
      
      res.json(config);
    } catch (error) {
      console.error('Error getting dashboard config:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Save dashboard configuration
  router.post('/dashboard/config', authenticateToken, async (req, res) => {
    try {
      const { layout, theme, refreshInterval } = req.body;
      
      const [config, created] = await models.DashboardConfig.findOrCreate({
        where: {
          tenantId: req.user.tenantId.toString(),
          userId: req.user.id
        },
        defaults: {
          name: 'My Dashboard',
          layout,
          theme,
          refreshInterval
        }
      });
      
      if (!created) {
        await config.update({ layout, theme, refreshInterval });
      }
      
      res.json(config);
    } catch (error) {
      console.error('Error saving dashboard config:', error);
      res.status(400).json({ error: error.message });
    }
  });
  

// Add these routes to your reporting-routes.js file

// ===== Lead Source Filtering Routes =====

// Get available lead sources for filtering
router.get('/lead-sources', authenticateToken, async (req, res) => {
  try {
    const sources = await reportingService.getLeadSources(req.user.tenantId);
    res.json(sources);
  } catch (error) {
    console.error('Error getting lead sources:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get available lead tags for filtering
router.get('/lead-tags', authenticateToken, async (req, res) => {
  try {
    const tags = await reportingService.getLeadTags(req.user.tenantId);
    res.json(tags);
  } catch (error) {
    console.error('Error getting lead tags:', error);
    res.status(400).json({ error: error.message });
  }
});

// ===== Lead Source Performance Reports =====

// Generate lead source performance report
router.post('/reports/lead-source-performance', authenticateToken, async (req, res) => {
  try {
    const report = await reportingService.generateLeadSourcePerformanceReport(
      req.user.tenantId,
      req.body
    );
    res.json(report);
  } catch (error) {
    console.error('Error generating lead source performance report:', error);
    res.status(400).json({ error: error.message });
  }
});

// Generate lead source comparison report
router.post('/reports/lead-source-comparison', authenticateToken, async (req, res) => {
  try {
    const report = await reportingService.generateLeadSourceComparisonReport(
      req.user.tenantId,
      req.body
    );
    res.json(report);
  } catch (error) {
    console.error('Error generating lead source comparison report:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get quick lead metrics for dashboard
router.get('/metrics/lead-summary', authenticateToken, async (req, res) => {
  try {
    const { 
      startDate = moment().startOf('day').format('YYYY-MM-DD'),
      endDate = moment().endOf('day').format('YYYY-MM-DD'),
      sources,
      closedTag = 'closed'
    } = req.query;
    
    const sourcesArray = sources ? sources.split(',') : [];
    
    const report = await reportingService.generateLeadSourcePerformanceReport(
      req.user.tenantId,
      {
        startDate,
        endDate,
        sources: sourcesArray,
        groupBy: 'day',
        closedTag,
        contactedStatuses: ['contacted', 'transferred']
      }
    );
    
    res.json({
      summary: report.summary,
      topSources: report.sourcePerformance.slice(0, 5),
      conversionFunnel: report.conversionFunnel
    });
  } catch (error) {
    console.error('Error getting lead metrics summary:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get lead trends for specific time periods
router.post('/reports/lead-trends', authenticateToken, async (req, res) => {
  try {
    const { 
      period = '30days', // 7days, 30days, 90days
      sources = [],
      closedTag = 'closed',
      contactedStatuses = ['contacted', 'transferred']
    } = req.body;
    
    let startDate, endDate, groupBy;
    
    switch (period) {
      case '7days':
        startDate = moment().subtract(7, 'days').startOf('day');
        endDate = moment().endOf('day');
        groupBy = 'day';
        break;
      case '30days':
        startDate = moment().subtract(30, 'days').startOf('day');
        endDate = moment().endOf('day');
        groupBy = 'day';
        break;
      case '90days':
        startDate = moment().subtract(90, 'days').startOf('day');
        endDate = moment().endOf('day');
        groupBy = 'week';
        break;
      default:
        startDate = moment().subtract(30, 'days').startOf('day');
        endDate = moment().endOf('day');
        groupBy = 'day';
    }
    
    const report = await reportingService.generateLeadSourcePerformanceReport(
      req.user.tenantId,
      {
        startDate: startDate.format('YYYY-MM-DD'),
        endDate: endDate.format('YYYY-MM-DD'),
        sources,
        groupBy,
        closedTag,
        contactedStatuses
      }
    );
    
    res.json({
      timeSeries: report.timeSeries,
      summary: report.summary,
      period,
      parameters: report.parameters
    });
  } catch (error) {
    console.error('Error getting lead trends:', error);
    res.status(400).json({ error: error.message });
  }
});

// Export lead source report
router.post('/reports/lead-source-performance/export', authenticateToken, async (req, res) => {
  try {
    const { format = 'csv', filename = 'lead_source_performance', ...reportParams } = req.body;
    
    // Generate the report
    const report = await reportingService.generateLeadSourcePerformanceReport(
      req.user.tenantId,
      reportParams
    );
    
    // Prepare data for export
    const exportData = {
      summary: report.summary,
      data: [
        // Source performance data
        ...report.sourcePerformance.map(source => ({
          type: 'Source Performance',
          source: source.source,
          newLeads: source.newLeads,
          contactedLeads: source.contactedLeads,
          closedLeads: source.closedLeads,
          contactRate: source.contactRate + '%',
          closeRate: source.closeRate + '%',
          contactToCloseRate: source.contactToCloseRate + '%',
          avgDaysToClose: source.avgDaysToClose
        })),
        
        // Time series data (first 100 rows to avoid overwhelming)
        ...report.timeSeries.slice(0, 100).map(item => ({
          type: 'Time Series',
          period: item.period,
          source: item.source,
          newLeads: item.newLeads,
          contactedLeads: item.contactedLeads,
          closedLeads: item.closedLeads,
          contactRate: item.contactRate + '%',
          closeRate: item.closeRate + '%'
        }))
      ]
    };
    
    const filepath = await reportingService.exportReport(
      exportData,
      format,
      `${filename}_${Date.now()}`
    );
    
    // Send file
    res.download(filepath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ error: 'Error downloading file' });
      }
      
      // Clean up file after sending
      require('fs').unlinkSync(filepath);
    });
  } catch (error) {
    console.error('Error exporting lead source report:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get lead source performance for specific source
router.get('/reports/lead-source/:source/performance', authenticateToken, async (req, res) => {
  try {
    const { source } = req.params;
    const { 
      startDate = moment().subtract(30, 'days').format('YYYY-MM-DD'),
      endDate = moment().format('YYYY-MM-DD'),
      groupBy = 'day',
      closedTag = 'closed'
    } = req.query;
    
    const report = await reportingService.generateLeadSourcePerformanceReport(
      req.user.tenantId,
      {
        startDate,
        endDate,
        sources: [source],
        groupBy,
        closedTag,
        contactedStatuses: ['contacted', 'transferred']
      }
    );
    
    const sourceData = report.sourcePerformance.find(s => s.source === source);
    const sourceTimeSeries = report.timeSeries.filter(t => t.source === source);
    
    res.json({
      source,
      performance: sourceData,
      timeSeries: sourceTimeSeries,
      conversionFunnel: report.conversionFunnel,
      parameters: report.parameters
    });
  } catch (error) {
    console.error('Error getting source performance:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get real-time lead metrics for dashboard widget
router.get('/metrics/real-time-leads', authenticateToken, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const today = moment().startOf('day');
    const yesterday = moment().subtract(1, 'day').startOf('day');
    
    const [todayStats, yesterdayStats] = await Promise.all([
      // Today's stats
      models.Lead.findOne({
        where: {
          tenantId,
          createdAt: { [Op.gte]: today.toDate() }
        },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'newLeads'],
          [sequelize.fn('SUM', sequelize.literal(`CASE WHEN status IN ('contacted', 'transferred') THEN 1 ELSE 0 END`)), 'contactedLeads'],
          [sequelize.fn('SUM', sequelize.literal(`CASE WHEN "additionalData"::jsonb ? 'tags' AND "additionalData"::jsonb->'tags' @> '"closed"'::jsonb THEN 1 ELSE 0 END`)), 'closedLeads']
        ],
        raw: true
      }),
      
      // Yesterday's stats for comparison
      models.Lead.findOne({
        where: {
          tenantId,
          createdAt: { 
            [Op.between]: [yesterday.toDate(), today.toDate()] 
          }
        },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'newLeads'],
          [sequelize.fn('SUM', sequelize.literal(`CASE WHEN status IN ('contacted', 'transferred') THEN 1 ELSE 0 END`)), 'contactedLeads'],
          [sequelize.fn('SUM', sequelize.literal(`CASE WHEN "additionalData"::jsonb ? 'tags' AND "additionalData"::jsonb->'tags' @> '"closed"'::jsonb THEN 1 ELSE 0 END`)), 'closedLeads']
        ],
        raw: true
      })
    ]);
    
    const todayNewLeads = parseInt(todayStats.newLeads || 0);
    const todayContactedLeads = parseInt(todayStats.contactedLeads || 0);
    const todayClosedLeads = parseInt(todayStats.closedLeads || 0);
    
    const yesterdayNewLeads = parseInt(yesterdayStats.newLeads || 0);
    const yesterdayContactedLeads = parseInt(yesterdayStats.contactedLeads || 0);
    const yesterdayClosedLeads = parseInt(yesterdayStats.closedLeads || 0);
    
    res.json({
      today: {
        newLeads: todayNewLeads,
        contactedLeads: todayContactedLeads,
        closedLeads: todayClosedLeads,
        contactRate: todayNewLeads > 0 ? (todayContactedLeads / todayNewLeads * 100).toFixed(1) : 0,
        closeRate: todayNewLeads > 0 ? (todayClosedLeads / todayNewLeads * 100).toFixed(1) : 0
      },
      trends: {
        newLeads: todayNewLeads - yesterdayNewLeads,
        contactedLeads: todayContactedLeads - yesterdayContactedLeads,
        closedLeads: todayClosedLeads - yesterdayClosedLeads
      },
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('Error getting real-time lead metrics:', error);
    res.status(400).json({ error: error.message });
  }
});




  // ===== Journey Overview Routes =====
  
  // Get journey overview report
  router.post('/reports/journey-overview', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.getJourneyOverviewReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating journey overview report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get journey funnel data
  router.get('/reports/journey-funnel/:journeyId', authenticateToken, async (req, res) => {
    try {
      const data = await reportingService.getJourneyFunnelData(
        req.user.tenantId,
        req.params.journeyId,
        req.query
      );
      res.json(data);
    } catch (error) {
      console.error('Error getting journey funnel data:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Compare journeys
  router.post('/reports/journey-compare', authenticateToken, async (req, res) => {
    try {
      const { journeyIds, startDate, endDate } = req.body;
      
      if (!journeyIds || journeyIds.length < 2) {
        return res.status(400).json({ error: 'At least 2 journey IDs required for comparison' });
      }
      
      const comparisons = await Promise.all(
        journeyIds.map(id => 
          reportingService.getJourneyOverviewReport(req.user.tenantId, {
            journeyIds: [id],
            startDate,
            endDate
          })
        )
      );
      
      res.json({
        journeys: comparisons.map(c => c.journeys[0]),
        parameters: { journeyIds, startDate, endDate }
      });
    } catch (error) {
      console.error('Error comparing journeys:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Lead Generation Routes =====
  
  // Get lead generation source report
  router.post('/reports/lead-gen/sources', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.getLeadGenSourceReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating lead gen source report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get lead quality report
  router.post('/reports/lead-gen/quality', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.getLeadQualityReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating lead quality report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get lead conversion funnel
  router.post('/reports/lead-gen/funnel', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.generateLeadConversionReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating lead conversion funnel:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Existing Report Routes (kept for compatibility) =====
  
  // Generate call summary report
  router.post('/reports/call-summary', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.generateCallSummaryReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating call summary report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Generate SMS summary report
  router.post('/reports/sms-summary', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.generateSmsSummaryReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating SMS summary report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Generate agent performance report
  router.post('/reports/agent-performance', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.generateAgentPerformanceReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating agent performance report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Generate lead conversion report
  router.post('/reports/lead-conversion', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.generateLeadConversionReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating lead conversion report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Generate journey analytics report
  router.post('/reports/journey-analytics', authenticateToken, async (req, res) => {
    try {
      const report = await reportingService.generateJourneyAnalyticsReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating journey analytics report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Generate custom report
  router.post('/reports/custom', authenticateToken, async (req, res) => {
    try {
      // Only allow admin users to run custom reports
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin role required.' });
      }
      
      const report = await reportingService.generateCustomReport(
        req.user.tenantId,
        req.body
      );
      res.json(report);
    } catch (error) {
      console.error('Error generating custom report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Report Export Routes =====
  
  // Export report
  router.post('/reports/export', authenticateToken, async (req, res) => {
    try {
      const { reportData, format = 'csv', filename = 'report' } = req.body;
      
      if (!reportData) {
        return res.status(400).json({ error: 'Report data is required' });
      }
      
      const filepath = await reportingService.exportReport(
        reportData,
        format,
        `${filename}_${Date.now()}`
      );
      
      // Send file
      res.download(filepath, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          res.status(500).json({ error: 'Error downloading file' });
        }
        
        // Clean up file after sending
        require('fs').unlinkSync(filepath);
      });
    } catch (error) {
      console.error('Error exporting report:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Report Template Routes =====
  
  // List report templates
  router.get('/report-templates', authenticateToken, async (req, res) => {
    try {
      const templates = await models.ReportTemplate.findAll({
        where: { 
          tenantId: req.user.tenantId.toString(),
          isActive: true
        },
        order: [['name', 'ASC']]
      });
      res.json(templates);
    } catch (error) {
      console.error('Error listing report templates:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get report template
  router.get('/report-templates/:id', authenticateToken, async (req, res) => {
    try {
      const template = await models.ReportTemplate.findOne({
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId.toString()
        }
      });
      
      if (!template) {
        return res.status(404).json({ error: 'Report template not found' });
      }
      
      res.json(template);
    } catch (error) {
      console.error('Error getting report template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Create report template
  router.post('/report-templates', authenticateToken, async (req, res) => {
    try {
      const template = await models.ReportTemplate.create({
        tenantId: req.user.tenantId.toString(),
        ...req.body,
        createdBy: req.user.id,
        lastModifiedBy: req.user.id
      });
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating report template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Update report template
  router.put('/report-templates/:id', authenticateToken, async (req, res) => {
    try {
      const [updated] = await models.ReportTemplate.update(
        {
          ...req.body,
          lastModifiedBy: req.user.id
        },
        {
          where: {
            id: req.params.id,
            tenantId: req.user.tenantId.toString()
          }
        }
      );
      
      if (!updated) {
        return res.status(404).json({ error: 'Report template not found' });
      }
      
      const template = await models.ReportTemplate.findByPk(req.params.id);
      res.json(template);
    } catch (error) {
      console.error('Error updating report template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Delete report template
  router.delete('/report-templates/:id', authenticateToken, async (req, res) => {
    try {
      const result = await models.ReportTemplate.destroy({
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId.toString()
        }
      });
      
      if (!result) {
        return res.status(404).json({ error: 'Report template not found' });
      }
      
      res.json({ message: 'Report template deleted successfully' });
    } catch (error) {
      console.error('Error deleting report template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // ===== Quick Stats Routes =====
  
  // Get today's stats
  router.get('/stats/today', authenticateToken, async (req, res) => {
    try {
      const today = moment().format('YYYY-MM-DD');
      
      const [callStats, smsStats, leadStats] = await Promise.all([
        models.CallStatistics.findOne({
          where: {
            tenantId: req.user.tenantId.toString(),
            date: today,
            hour: null
          }
        }),
        models.SmsStatistics ? models.SmsStatistics.findOne({
          where: {
            tenantId: req.user.tenantId.toString(),
            date: today,
            hour: null
          }
        }) : null,
        models.LeadMetrics.findOne({
          where: {
            tenantId: req.user.tenantId.toString(),
            date: today,
            source: null,
            brand: null
          },
          attributes: [
            [sequelize.fn('SUM', sequelize.col('totalLeads')), 'totalLeads'],
            [sequelize.fn('SUM', sequelize.col('contactedLeads')), 'contactedLeads'],
            [sequelize.fn('SUM', sequelize.col('transferredLeads')), 'transferredLeads'],
            [sequelize.fn('SUM', sequelize.col('convertedLeads')), 'convertedLeads']
          ],
          raw: true
        })
      ]);
      
      res.json({
        calls: callStats || { totalCalls: 0, answeredCalls: 0, transferredCalls: 0, failedCalls: 0 },
        sms: smsStats || { totalSent: 0, totalDelivered: 0, totalInbound: 0 },
        leads: leadStats || { totalLeads: 0, contactedLeads: 0, transferredLeads: 0 }
      });
    } catch (error) {
      console.error('Error getting today stats:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get hourly breakdown for today
  router.get('/stats/hourly', authenticateToken, async (req, res) => {
    try {
      const today = moment().format('YYYY-MM-DD');
      
      const callStats = await models.CallStatistics.findAll({
        where: {
          tenantId: req.user.tenantId.toString(),
          date: today,
          hour: { [Op.ne]: null }
        },
        order: [['hour', 'ASC']]
      });
      
      const smsStats = models.SmsStatistics ? await models.SmsStatistics.findAll({
        where: {
          tenantId: req.user.tenantId.toString(),
          date: today,
          hour: { [Op.ne]: null }
        },
        order: [['hour', 'ASC']]
      }) : [];
      
      res.json({
        calls: callStats,
        sms: smsStats
      });
    } catch (error) {
      console.error('Error getting hourly stats:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Register routes with app
  app.use('/api', router);
  
  // ===== Background Tasks (Cron Jobs) =====
  
  // Update dashboard stats every minute
  cron.schedule('* * * * *', async () => {
    try {
      console.log('Updating dashboard stats...');
      const tenants = await models.Tenant.findAll({ 
        attributes: ['id']
      });
      
      for (const tenant of tenants) {
        try {
          await reportingService.updateDashboardStats(tenant.id);
        } catch (error) {
          console.error(`Error updating dashboard stats for tenant ${tenant.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error updating dashboard stats:', error);
    }
  });
  
  // Aggregate statistics daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('Running daily statistics aggregation...');
      await reportingService.aggregateStatistics();
    } catch (error) {
      console.error('Error aggregating statistics:', error);
    }
  });
  
  // Execute scheduled reports every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      console.log('Checking for scheduled reports...');
      await reportingService.executeScheduledReports();
    } catch (error) {
      console.error('Error executing scheduled reports:', error);
    }
  });
  
  console.log('Enhanced reporting module initialized with routes and background tasks');
  
  return reportingModels;
};