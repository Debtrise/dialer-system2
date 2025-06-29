const { Op, fn, col, literal } = require('sequelize');
const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const fs = require('fs').promises;
const path = require('path');

class ReportingService {
  constructor(models, sequelize) {
    this.models = models;
    this.sequelize = sequelize;
  }

  /**
   * Helper method to ensure tenant ID is always a string
   */
  ensureTenantIdString(tenantId) {
    if (typeof tenantId === 'string') return tenantId;
    if (typeof tenantId === 'number') return tenantId.toString();
    if (tenantId && typeof tenantId === 'object' && tenantId.id) {
      return tenantId.id.toString();
    }
    throw new Error(`Invalid tenant ID: ${tenantId}`);
  }

/**
 * Generate call summary report
 */
async generateCallSummaryReport(tenantId, params) {
  const { startDate, endDate, groupBy = 'day', filters = {} } = params;
  
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const start = moment(startDate).startOf('day');
    const end = moment(endDate).endOf('day');
    
    // Base query
    const whereClause = {
      tenantId,
      startTime: {
        [Op.between]: [start.toDate(), end.toDate()]
      }
    };
    
    // Apply filters
    if (filters.status) whereClause.status = filters.status;
    if (filters.agentId) whereClause.agentId = filters.agentId;
    if (filters.didId) whereClause.didId = filters.didId;
    
    // Get aggregated data
    let groupByClause, selectClause, orderByClause;
    
   switch (groupBy) {
  case 'hour':
    groupByClause = [
      this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('startTime')),
      this.sequelize.fn('EXTRACT', this.sequelize.literal('HOUR FROM "startTime"'))
    ];
    selectClause = [
      [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('startTime')), 'date'],
      [this.sequelize.fn('EXTRACT', this.sequelize.literal('HOUR FROM "startTime"')), 'hour']
    ];
    orderByClause = [['date', 'ASC'], ['hour', 'ASC']];
    break;
    
  case 'day':
    groupByClause = [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('startTime'))];
    selectClause = [[this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('startTime')), 'date']];
    orderByClause = [['date', 'ASC']];
    break;
    
  case 'week':
    groupByClause = [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'week'"), this.sequelize.col('startTime'))];
    selectClause = [[this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'week'"), this.sequelize.col('startTime')), 'week']];
    orderByClause = [['week', 'ASC']];
    break;
    
  case 'month':
    groupByClause = [
      this.sequelize.fn('EXTRACT', this.sequelize.literal('YEAR FROM "startTime"')),
      this.sequelize.fn('EXTRACT', this.sequelize.literal('MONTH FROM "startTime"'))
    ];
    selectClause = [
      [this.sequelize.fn('EXTRACT', this.sequelize.literal('YEAR FROM "startTime"')), 'year'],
      [this.sequelize.fn('EXTRACT', this.sequelize.literal('MONTH FROM "startTime"')), 'month']
    ];
    orderByClause = [['year', 'ASC'], ['month', 'ASC']];
    break;
}
    
    const results = await this.models.CallLog.findAll({
      where: whereClause,
      attributes: [
        ...selectClause,
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalCalls'],
        [this.sequelize.fn('COUNT', this.sequelize.fn('DISTINCT', this.sequelize.col('leadId'))), 'uniqueLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'answered' THEN 1 ELSE 0 END`)), 'answeredCalls'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'failed' THEN 1 ELSE 0 END`)), 'failedCalls'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredCalls'],
        [this.sequelize.fn('AVG', this.sequelize.col('duration')), 'avgDuration'],
        [this.sequelize.fn('SUM', this.sequelize.col('duration')), 'totalDuration'],
        [this.sequelize.fn('MIN', this.sequelize.col('duration')), 'minDuration'],
        [this.sequelize.fn('MAX', this.sequelize.col('duration')), 'maxDuration']
      ],
      group: groupByClause,
      order: orderByClause,
      raw: true
    });
    
    // Calculate additional metrics
    const summary = {
      totalCalls: results.reduce((sum, r) => sum + parseInt(r.totalCalls || 0), 0),
      uniqueLeads: await this.models.CallLog.count({
        where: whereClause,
        distinct: true,
        col: 'leadId'
      }),
      answeredCalls: results.reduce((sum, r) => sum + parseInt(r.answeredCalls || 0), 0),
      failedCalls: results.reduce((sum, r) => sum + parseInt(r.failedCalls || 0), 0),
      transferredCalls: results.reduce((sum, r) => sum + parseInt(r.transferredCalls || 0), 0),
      avgDuration: results.length > 0 ? results.reduce((sum, r) => sum + parseFloat(r.avgDuration || 0), 0) / results.length : 0,
      totalDuration: results.reduce((sum, r) => sum + parseInt(r.totalDuration || 0), 0)
    };
    
    summary.connectionRate = summary.totalCalls > 0 
      ? (summary.answeredCalls / summary.totalCalls * 100).toFixed(2) 
      : 0;
    
    summary.transferRate = summary.answeredCalls > 0
      ? (summary.transferredCalls / summary.answeredCalls * 100).toFixed(2)
      : 0;
    
    // Get top DIDs
    const topDIDs = await this.models.CallLog.findAll({
      where: whereClause,
      attributes: [
        'from',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'callCount']
      ],
      group: ['from'],
      order: [[this.sequelize.literal('COUNT("id")'), 'DESC']],
      limit: 10,
      raw: true
    });
    
    // Get hourly distribution
    const hourlyDistribution = await this.models.CallLog.findAll({
      where: whereClause,
      attributes: [
        [this.sequelize.fn('EXTRACT', this.sequelize.literal('HOUR FROM "startTime"')), 'hour'],
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'calls']
      ],
      group: [this.sequelize.fn('EXTRACT', this.sequelize.literal('HOUR FROM "startTime"'))],
      order: [[this.sequelize.literal('EXTRACT(HOUR FROM "startTime")'), 'ASC']],
      raw: true
    });
    
    return {
      summary,
      data: results,
      topDIDs,
      hourlyDistribution,
      parameters: {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        groupBy,
        filters
      }
    };
  } catch (error) {
    console.error('Error generating call summary report:', error);
    throw error;
  }
}

/**
   * Generate SMS summary report
   */
  async generateSmsSummaryReport(tenantId, params) {
    const { startDate, endDate, groupBy = 'day', filters = {} } = params;
    
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      // Base query
      const whereClause = {
        tenantId,
        createdAt: {
          [Op.between]: [start.toDate(), end.toDate()]
        }
      };
      
      // Apply filters
      if (filters.direction) whereClause.direction = filters.direction;
      if (filters.status) whereClause.status = filters.status;
      if (filters.fromNumber) whereClause.from = filters.fromNumber;
      
      // Get aggregated data
      let groupByClause, selectClause;
      
      switch (groupBy) {
  case 'hour':
    groupByClause = [
      this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('createdAt')),
      this.sequelize.fn('EXTRACT', this.sequelize.literal('HOUR FROM "createdAt"'))
    ];
    selectClause = [
      [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('createdAt')), 'date'],
      [this.sequelize.fn('EXTRACT', this.sequelize.literal('HOUR FROM "createdAt"')), 'hour']
    ];
    break;
    
  case 'day':
    groupByClause = [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('createdAt'))];
    selectClause = [[this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('createdAt')), 'date']];
    break;
    
  case 'month':
    groupByClause = [
      this.sequelize.fn('EXTRACT', this.sequelize.literal('YEAR FROM "createdAt"')),
      this.sequelize.fn('EXTRACT', this.sequelize.literal('MONTH FROM "createdAt"'))
    ];
    selectClause = [
      [this.sequelize.fn('EXTRACT', this.sequelize.literal('YEAR FROM "createdAt"')), 'year'],
      [this.sequelize.fn('EXTRACT', this.sequelize.literal('MONTH FROM "createdAt"')), 'month']
    ];
    break;
}
      
      const results = await this.models.SmsMessage.findAll({
        where: whereClause,
        attributes: [
          ...selectClause,
          [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalMessages'],
          [this.sequelize.fn('COUNT', this.sequelize.fn('DISTINCT', this.sequelize.col('leadId'))), 'uniqueLeads'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END`)), 'outboundMessages'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END`)), 'inboundMessages'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'delivered' THEN 1 ELSE 0 END`)), 'deliveredMessages'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'failed' THEN 1 ELSE 0 END`)), 'failedMessages'],
          [this.sequelize.fn('SUM', this.sequelize.col('price')), 'totalCost']
        ],
        group: groupByClause,
        order: selectClause,
        raw: true
      });
      
      // Calculate summary
      const summary = {
        totalMessages: results.reduce((sum, r) => sum + parseInt(r.totalMessages), 0),
        uniqueLeads: await this.models.SmsMessage.count({
          where: whereClause,
          distinct: true,
          col: 'leadId'
        }),
        outboundMessages: results.reduce((sum, r) => sum + parseInt(r.outboundMessages), 0),
        inboundMessages: results.reduce((sum, r) => sum + parseInt(r.inboundMessages), 0),
        deliveredMessages: results.reduce((sum, r) => sum + parseInt(r.deliveredMessages), 0),
        failedMessages: results.reduce((sum, r) => sum + parseInt(r.failedMessages), 0),
        totalCost: results.reduce((sum, r) => sum + parseFloat(r.totalCost || 0), 0)
      };
      
      summary.deliveryRate = summary.outboundMessages > 0
        ? (summary.deliveredMessages / summary.outboundMessages * 100).toFixed(2)
        : 0;
      
      // Get top phone numbers
      const topNumbers = await this.models.SmsMessage.findAll({
        where: {
          ...whereClause,
          direction: 'outbound'
        },
        attributes: [
          'from',
          [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'messageCount']
        ],
        group: ['from'],
        order: [[this.sequelize.fn('COUNT', this.sequelize.col('id')), 'DESC']],
        limit: 10,
        raw: true
      });
      
      // Get template usage
      const templateUsage = await this.models.SmsMessage.findAll({
        where: {
          ...whereClause,
          templateId: { [Op.ne]: null }
        },
        attributes: [
          'templateId',
          [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'useCount']
        ],
        group: ['templateId'],
        order: [[this.sequelize.fn('COUNT', this.sequelize.col('id')), 'DESC']],
        limit: 10,
        raw: true
      });
      
      // Get template details
      if (templateUsage.length > 0) {
        const templateIds = templateUsage.map(t => t.templateId);
        const templates = await this.models.Template.findAll({
          where: { id: templateIds },
          attributes: ['id', 'name']
        });
        
        const templateMap = templates.reduce((map, t) => {
          map[t.id] = t.name;
          return map;
        }, {});
        
        templateUsage.forEach(t => {
          t.templateName = templateMap[t.templateId] || 'Unknown';
        });
      }
      
      return {
        summary,
        data: results,
        topNumbers,
        templateUsage,
        parameters: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          groupBy,
          filters
        }
      };
    } catch (error) {
      console.error('Error generating SMS summary report:', error);
      throw error;
    }
  }

// Add these methods to your reporting-service.js file

/**
 * Get available lead sources for filtering
 */
async getLeadSources(tenantId) {
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const sources = await this.models.Lead.findAll({
      where: { 
        tenantId,
        source: { [Op.ne]: null }
      },
      attributes: [
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'leadCount'],
        [this.sequelize.fn('MIN', this.sequelize.col('createdAt')), 'firstLeadDate'],
        [this.sequelize.fn('MAX', this.sequelize.col('createdAt')), 'lastLeadDate']
      ],
      group: ['source'],
      order: [[this.sequelize.literal('COUNT("id")'), 'DESC']],
      raw: true
    });
    
    return sources.map(source => ({
      source: source.source,
      leadCount: parseInt(source.leadCount),
      firstLeadDate: source.firstLeadDate,
      lastLeadDate: source.lastLeadDate
    }));
  } catch (error) {
    console.error('Error getting lead sources:', error);
    throw error;
  }
}

/**
 * Get available lead tags for filtering (for closed leads)
 */
async getLeadTags(tenantId) {
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const leads = await this.models.Lead.findAll({
      where: { 
        tenantId,
        additionalData: {
          [Op.contains]: { tags: [] }
        }
      },
      attributes: ['additionalData'],
      raw: true
    });
    
    const tagCounts = {};
    leads.forEach(lead => {
      const tags = lead.additionalData?.tags || [];
      tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    
    return Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error('Error getting lead tags:', error);
    throw error;
  }
}

// Add these methods to your reporting-service.js file

/**
 * Get available lead sources for filtering
 */
async getLeadSources(tenantId) {
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const sources = await this.models.Lead.findAll({
      where: { 
        tenantId,
        source: { [Op.ne]: null }
      },
      attributes: [
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'leadCount'],
        [this.sequelize.fn('MIN', this.sequelize.col('createdAt')), 'firstLeadDate'],
        [this.sequelize.fn('MAX', this.sequelize.col('createdAt')), 'lastLeadDate']
      ],
      group: ['source'],
      order: [[this.sequelize.literal('COUNT("id")'), 'DESC']],
      raw: true
    });
    
    return sources.map(source => ({
      source: source.source,
      leadCount: parseInt(source.leadCount),
      firstLeadDate: source.firstLeadDate,
      lastLeadDate: source.lastLeadDate
    }));
  } catch (error) {
    console.error('Error getting lead sources:', error);
    throw error;
  }
}

/**
 * Get available lead tags for filtering (for closed leads)
 */
async getLeadTags(tenantId) {
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const leads = await this.models.Lead.findAll({
      where: { 
        tenantId,
        additionalData: {
          [Op.contains]: { tags: [] }
        }
      },
      attributes: ['additionalData'],
      raw: true
    });
    
    const tagCounts = {};
    leads.forEach(lead => {
      const tags = lead.additionalData?.tags || [];
      tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    
    return Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error('Error getting lead tags:', error);
    throw error;
  }
}

/**
 * Generate comprehensive lead source performance report
 * This is the main report you requested
 */
async generateLeadSourcePerformanceReport(tenantId, params) {
  const { 
    startDate, 
    endDate, 
    sources = [], 
    groupBy = 'day', // day, week, month
    closedTag = 'closed', // Tag that identifies closed leads
    contactedStatuses = ['contacted', 'transferred'] // Statuses that count as contacted
  } = params;
  
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const start = moment(startDate).startOf('day');
    const end = moment(endDate).endOf('day');
    
    // Build base query
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [start.toDate(), end.toDate()]
      }
    };
    
    // Apply source filter if specified
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    // Get time series data for new leads
    const newLeadsTimeSeries = await this.getLeadTimeSeriesData(
      tenantId,
      start,
      end,
      groupBy,
      sources,
      'new'
    );
    
    // Get time series data for contacted leads
    const contactedLeadsTimeSeries = await this.getLeadTimeSeriesData(
      tenantId,
      start,
      end,
      groupBy,
      sources,
      'contacted',
      contactedStatuses
    );
    
    // Get time series data for closed leads (by tag)
    const closedLeadsTimeSeries = await this.getLeadTimeSeriesData(
      tenantId,
      start,
      end,
      groupBy,
      sources,
      'closed',
      null,
      closedTag
    );
    
    // Get source performance summary
    const sourcePerformance = await this.getSourcePerformanceSummary(
      tenantId,
      start,
      end,
      sources,
      contactedStatuses,
      closedTag
    );
    
    // Get conversion funnel
    const conversionFunnel = await this.getLeadConversionFunnel(
      tenantId,
      start,
      end,
      sources,
      contactedStatuses,
      closedTag
    );
    
    // Combine time series data
    const combinedTimeSeries = this.combineTimeSeriesData(
      newLeadsTimeSeries,
      contactedLeadsTimeSeries,
      closedLeadsTimeSeries,
      groupBy
    );
    
    return {
      summary: {
        totalNewLeads: sourcePerformance.reduce((sum, s) => sum + s.newLeads, 0),
        totalContactedLeads: sourcePerformance.reduce((sum, s) => sum + s.contactedLeads, 0),
        totalClosedLeads: sourcePerformance.reduce((sum, s) => sum + s.closedLeads, 0),
        overallContactRate: this.calculateRate(
          sourcePerformance.reduce((sum, s) => sum + s.contactedLeads, 0),
          sourcePerformance.reduce((sum, s) => sum + s.newLeads, 0)
        ),
        overallCloseRate: this.calculateRate(
          sourcePerformance.reduce((sum, s) => sum + s.closedLeads, 0),
          sourcePerformance.reduce((sum, s) => sum + s.newLeads, 0)
        )
      },
      sourcePerformance,
      timeSeries: combinedTimeSeries,
      conversionFunnel,
      parameters: {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        sources,
        groupBy,
        closedTag,
        contactedStatuses
      }
    };
  } catch (error) {
    console.error('Error generating lead source performance report:', error);
    throw error;
  }
}

async getLeadTimeSeriesData(tenantId, startDate, endDate, groupBy, sources, type, statuses = null, tag = null) {
  try {
    let selectClause;
    
    switch (groupBy) {
      case 'day':
        selectClause = [this.sequelize.fn('TO_CHAR', this.sequelize.col('createdAt'), 'YYYY-MM-DD'), 'period'];
        break;
      case 'week':
        selectClause = [this.sequelize.fn('TO_CHAR', this.sequelize.col('createdAt'), 'YYYY-"Week"-IW'), 'period'];
        break;
      case 'month':
        selectClause = [this.sequelize.fn('TO_CHAR', this.sequelize.col('createdAt'), 'YYYY-MM'), 'period'];
        break;
      default:
        selectClause = [this.sequelize.fn('TO_CHAR', this.sequelize.col('createdAt'), 'YYYY-MM-DD'), 'period'];
    }
    
    // Build where clause
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [startDate.toDate(), endDate.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    // Add specific conditions based on type
    if (type === 'contacted' && statuses) {
      whereClause.status = { [Op.in]: statuses };
    }
    
    if (type === 'closed' && tag) {
      whereClause.additionalData = {
        [Op.contains]: { tags: [tag] }
      };
    }
    
    const results = await this.models.Lead.findAll({
      where: whereClause,
      attributes: [
        selectClause,
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'count']
      ],
      group: ['period', 'source'],
      order: [['period', 'ASC']],
      raw: true
    });
    
    return results.map(row => ({
      period: row.period,
      source: row.source,
      count: parseInt(row.count),
      type
    }));
  } catch (error) {
    console.error(`Error getting ${type} leads time series:`, error);
    throw error;
  }
}

// ALSO ADD these new methods to your reporting-service.js file:

/**
 * Get available lead sources for filtering
 */
async getLeadSources(tenantId) {
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const sources = await this.models.Lead.findAll({
      where: { 
        tenantId,
        source: { [Op.ne]: null }
      },
      attributes: [
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'leadCount'],
        [this.sequelize.fn('MIN', this.sequelize.col('createdAt')), 'firstLeadDate'],
        [this.sequelize.fn('MAX', this.sequelize.col('createdAt')), 'lastLeadDate']
      ],
      group: ['source'],
      order: [[this.sequelize.literal('COUNT("id")'), 'DESC']],
      raw: true
    });
    
    return sources.map(source => ({
      source: source.source,
      leadCount: parseInt(source.leadCount),
      firstLeadDate: source.firstLeadDate,
      lastLeadDate: source.lastLeadDate
    }));
  } catch (error) {
    console.error('Error getting lead sources:', error);
    throw error;
  }
}

/**
 * Get available lead tags for filtering (for closed leads)
 */
async getLeadTags(tenantId) {
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const leads = await this.models.Lead.findAll({
      where: { 
        tenantId,
        additionalData: {
          [Op.contains]: { tags: [] }
        }
      },
      attributes: ['additionalData'],
      raw: true
    });
    
    const tagCounts = {};
    leads.forEach(lead => {
      const tags = lead.additionalData?.tags || [];
      tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    
    return Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error('Error getting lead tags:', error);
    throw error;
  }
}

/**
 * Generate comprehensive lead source performance report
 */
async generateLeadSourcePerformanceReport(tenantId, params) {
  const { 
    startDate, 
    endDate, 
    sources = [], 
    groupBy = 'day', // day, week, month
    closedTag = 'closed', // Tag that identifies closed leads
    contactedStatuses = ['contacted', 'transferred'] // Statuses that count as contacted
  } = params;
  
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const start = moment(startDate).startOf('day');
    const end = moment(endDate).endOf('day');
    
    // Build base query
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [start.toDate(), end.toDate()]
      }
    };
    
    // Apply source filter if specified
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    // Get time series data for new leads
    const newLeadsTimeSeries = await this.getLeadTimeSeriesData(
      tenantId,
      start,
      end,
      groupBy,
      sources,
      'new'
    );
    
    // Get time series data for contacted leads
    const contactedLeadsTimeSeries = await this.getLeadTimeSeriesData(
      tenantId,
      start,
      end,
      groupBy,
      sources,
      'contacted',
      contactedStatuses
    );
    
    // Get time series data for closed leads (by tag)
    const closedLeadsTimeSeries = await this.getLeadTimeSeriesData(
      tenantId,
      start,
      end,
      groupBy,
      sources,
      'closed',
      null,
      closedTag
    );
    
    // Get source performance summary
    const sourcePerformance = await this.getSourcePerformanceSummary(
      tenantId,
      start,
      end,
      sources,
      contactedStatuses,
      closedTag
    );
    
    // Get conversion funnel
    const conversionFunnel = await this.getLeadConversionFunnel(
      tenantId,
      start,
      end,
      sources,
      contactedStatuses,
      closedTag
    );
    
    // Combine time series data
    const combinedTimeSeries = this.combineTimeSeriesData(
      newLeadsTimeSeries,
      contactedLeadsTimeSeries,
      closedLeadsTimeSeries,
      groupBy
    );
    
    return {
      summary: {
        totalNewLeads: sourcePerformance.reduce((sum, s) => sum + s.newLeads, 0),
        totalContactedLeads: sourcePerformance.reduce((sum, s) => sum + s.contactedLeads, 0),
        totalClosedLeads: sourcePerformance.reduce((sum, s) => sum + s.closedLeads, 0),
        overallContactRate: this.calculateRate(
          sourcePerformance.reduce((sum, s) => sum + s.contactedLeads, 0),
          sourcePerformance.reduce((sum, s) => sum + s.newLeads, 0)
        ),
        overallCloseRate: this.calculateRate(
          sourcePerformance.reduce((sum, s) => sum + s.closedLeads, 0),
          sourcePerformance.reduce((sum, s) => sum + s.newLeads, 0)
        )
      },
      sourcePerformance,
      timeSeries: combinedTimeSeries,
      conversionFunnel,
      parameters: {
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        sources,
        groupBy,
        closedTag,
        contactedStatuses
      }
    };
  } catch (error) {
    console.error('Error generating lead source performance report:', error);
    throw error;
  }
}

async getSourcePerformanceSummary(tenantId, startDate, endDate, sources, contactedStatuses, closedTag) {
  try {
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [startDate.toDate(), endDate.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    const results = await this.models.Lead.findAll({
      where: whereClause,
      attributes: [
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'newLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN status IN (${contactedStatuses.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END`
        )), 'contactedLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN "additionalData"::jsonb ? 'tags' AND "additionalData"::jsonb->'tags' @> '"${closedTag}"'::jsonb THEN 1 ELSE 0 END`
        )), 'closedLeads'],
        [this.sequelize.fn('AVG', this.sequelize.literal(
          `EXTRACT(EPOCH FROM (COALESCE("updatedAt", NOW()) - "createdAt")) / 86400`
        )), 'avgDaysToClose']
      ],
      group: ['source'],
      order: [[this.sequelize.literal('COUNT("id")'), 'DESC']],
      raw: true
    });
    
    return results.map(row => {
      const newLeads = parseInt(row.newLeads);
      const contactedLeads = parseInt(row.contactedLeads);
      const closedLeads = parseInt(row.closedLeads);
      
      return {
        source: row.source,
        newLeads,
        contactedLeads,
        closedLeads,
        contactRate: this.calculateRate(contactedLeads, newLeads),
        closeRate: this.calculateRate(closedLeads, newLeads),
        contactToCloseRate: this.calculateRate(closedLeads, contactedLeads),
        avgDaysToClose: parseFloat(row.avgDaysToClose || 0).toFixed(1)
      };
    });
  } catch (error) {
    console.error('Error getting source performance summary:', error);
    throw error;
  }
}

/**
 * Get lead conversion funnel
 */
async getLeadConversionFunnel(tenantId, startDate, endDate, sources, contactedStatuses, closedTag) {
  try {
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [startDate.toDate(), endDate.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    const results = await this.models.Lead.findOne({
      where: whereClause,
      attributes: [
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN status IN (${contactedStatuses.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END`
        )), 'contactedLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN "additionalData"::jsonb ? 'tags' AND "additionalData"::jsonb->'tags' @> '"${closedTag}"'::jsonb THEN 1 ELSE 0 END`
        )), 'closedLeads']
      ],
      raw: true
    });
    
    const totalLeads = parseInt(results.totalLeads);
    const contactedLeads = parseInt(results.contactedLeads);
    const closedLeads = parseInt(results.closedLeads);
    
    return {
      stages: [
        {
          name: 'New Leads',
          count: totalLeads,
          percentage: 100,
          dropoffFromPrevious: 0
        },
        {
          name: 'Contacted',
          count: contactedLeads,
          percentage: this.calculateRate(contactedLeads, totalLeads),
          dropoffFromPrevious: totalLeads - contactedLeads
        },
        {
          name: 'Closed',
          count: closedLeads,
          percentage: this.calculateRate(closedLeads, totalLeads),
          dropoffFromPrevious: contactedLeads - closedLeads
        }
      ],
      conversionRates: {
        leadToContact: this.calculateRate(contactedLeads, totalLeads),
        leadToClose: this.calculateRate(closedLeads, totalLeads),
        contactToClose: this.calculateRate(closedLeads, contactedLeads)
      }
    };
  } catch (error) {
    console.error('Error getting lead conversion funnel:', error);
    throw error;
  }
}

/**
 * Combine time series data from different types
 */
combineTimeSeriesData(newLeads, contactedLeads, closedLeads, groupBy) {
  const combined = {};
  
  // Process new leads
  newLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].newLeads = item.count;
  });
  
  // Process contacted leads
  contactedLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].contactedLeads = item.count;
  });
  
  // Process closed leads
  closedLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].closedLeads = item.count;
  });
  
  // Convert to array and add calculated fields
  return Object.values(combined).map(item => ({
    ...item,
    contactRate: this.calculateRate(item.contactedLeads, item.newLeads),
    closeRate: this.calculateRate(item.closedLeads, item.newLeads)
  })).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Calculate percentage rate
 */
calculateRate(numerator, denominator) {
  if (denominator === 0) return 0;
  return parseFloat((numerator / denominator * 100).toFixed(2));
}



async getSourcePerformanceSummary(tenantId, startDate, endDate, sources, contactedStatuses, closedTag) {
  try {
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [startDate.toDate(), endDate.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    const results = await this.models.Lead.findAll({
      where: whereClause,
      attributes: [
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'newLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN status IN (${contactedStatuses.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END`
        )), 'contactedLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN "additionalData"::jsonb ? 'tags' AND "additionalData"::jsonb->'tags' @> '"${closedTag}"'::jsonb THEN 1 ELSE 0 END`
        )), 'closedLeads'],
        [this.sequelize.fn('AVG', this.sequelize.literal(
          `EXTRACT(EPOCH FROM (COALESCE("updatedAt", NOW()) - "createdAt")) / 86400`
        )), 'avgDaysToClose']
      ],
      group: ['source'],
      order: [[this.sequelize.literal('COUNT("id")'), 'DESC']],
      raw: true
    });
    
    return results.map(row => {
      const newLeads = parseInt(row.newLeads);
      const contactedLeads = parseInt(row.contactedLeads);
      const closedLeads = parseInt(row.closedLeads);
      
      return {
        source: row.source,
        newLeads,
        contactedLeads,
        closedLeads,
        contactRate: this.calculateRate(contactedLeads, newLeads),
        closeRate: this.calculateRate(closedLeads, newLeads),
        contactToCloseRate: this.calculateRate(closedLeads, contactedLeads),
        avgDaysToClose: parseFloat(row.avgDaysToClose || 0).toFixed(1)
      };
    });
  } catch (error) {
    console.error('Error getting source performance summary:', error);
    throw error;
  }
}

/**
 * Get lead conversion funnel
 */
async getLeadConversionFunnel(tenantId, startDate, endDate, sources, contactedStatuses, closedTag) {
  try {
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [startDate.toDate(), endDate.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    const results = await this.models.Lead.findOne({
      where: whereClause,
      attributes: [
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN status IN (${contactedStatuses.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END`
        )), 'contactedLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN "additionalData"::jsonb ? 'tags' AND "additionalData"::jsonb->'tags' @> '"${closedTag}"'::jsonb THEN 1 ELSE 0 END`
        )), 'closedLeads']
      ],
      raw: true
    });
    
    const totalLeads = parseInt(results.totalLeads);
    const contactedLeads = parseInt(results.contactedLeads);
    const closedLeads = parseInt(results.closedLeads);
    
    return {
      stages: [
        {
          name: 'New Leads',
          count: totalLeads,
          percentage: 100,
          dropoffFromPrevious: 0
        },
        {
          name: 'Contacted',
          count: contactedLeads,
          percentage: this.calculateRate(contactedLeads, totalLeads),
          dropoffFromPrevious: totalLeads - contactedLeads
        },
        {
          name: 'Closed',
          count: closedLeads,
          percentage: this.calculateRate(closedLeads, totalLeads),
          dropoffFromPrevious: contactedLeads - closedLeads
        }
      ],
      conversionRates: {
        leadToContact: this.calculateRate(contactedLeads, totalLeads),
        leadToClose: this.calculateRate(closedLeads, totalLeads),
        contactToClose: this.calculateRate(closedLeads, contactedLeads)
      }
    };
  } catch (error) {
    console.error('Error getting lead conversion funnel:', error);
    throw error;
  }
}

/**
 * Combine time series data from different types
 */
combineTimeSeriesData(newLeads, contactedLeads, closedLeads, groupBy) {
  const combined = {};
  
  // Process new leads
  newLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].newLeads = item.count;
  });
  
  // Process contacted leads
  contactedLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].contactedLeads = item.count;
  });
  
  // Process closed leads
  closedLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].closedLeads = item.count;
  });
  
  // Convert to array and add calculated fields
  return Object.values(combined).map(item => ({
    ...item,
    contactRate: this.calculateRate(item.contactedLeads, item.newLeads),
    closeRate: this.calculateRate(item.closedLeads, item.newLeads)
  })).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Calculate percentage rate
 */
calculateRate(numerator, denominator) {
  if (denominator === 0) return 0;
  return parseFloat((numerator / denominator * 100).toFixed(2));
}

/**
 * Get lead source comparison report
 */
async generateLeadSourceComparisonReport(tenantId, params) {
  const { 
    startDate, 
    endDate, 
    compareStartDate,
    compareEndDate,
    sources = [],
    closedTag = 'closed',
    contactedStatuses = ['contacted', 'transferred']
  } = params;
  
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const currentPeriod = await this.getSourcePerformanceSummary(
      tenantId,
      moment(startDate),
      moment(endDate),
      sources,
      contactedStatuses,
      closedTag
    );
    
    const previousPeriod = await this.getSourcePerformanceSummary(
      tenantId,
      moment(compareStartDate),
      moment(compareEndDate),
      sources,
      contactedStatuses,
      closedTag
    );
    
    // Create comparison data
    const comparison = currentPeriod.map(current => {
      const previous = previousPeriod.find(p => p.source === current.source) || {
        newLeads: 0, contactedLeads: 0, closedLeads: 0, contactRate: 0, closeRate: 0
      };
      
      return {
        source: current.source,
        current: current,
        previous: previous,
        changes: {
          newLeads: current.newLeads - previous.newLeads,
          contactedLeads: current.contactedLeads - previous.contactedLeads,
          closedLeads: current.closedLeads - previous.closedLeads,
          contactRate: current.contactRate - previous.contactRate,
          closeRate: current.closeRate - previous.closeRate
        },
        percentageChanges: {
          newLeads: this.calculatePercentageChange(current.newLeads, previous.newLeads),
          contactedLeads: this.calculatePercentageChange(current.contactedLeads, previous.contactedLeads),
          closedLeads: this.calculatePercentageChange(current.closedLeads, previous.closedLeads),
          contactRate: this.calculatePercentageChange(current.contactRate, previous.contactRate),
          closeRate: this.calculatePercentageChange(current.closeRate, previous.closeRate)
        }
      };
    });
    
    return {
      comparison,
      summary: {
        totalSources: comparison.length,
        improvingSources: comparison.filter(c => c.changes.newLeads > 0).length,
        decliningSourcees: comparison.filter(c => c.changes.newLeads < 0).length
      },
      parameters: {
        currentPeriod: { startDate, endDate },
        previousPeriod: { startDate: compareStartDate, endDate: compareEndDate },
        sources,
        closedTag,
        contactedStatuses
      }
    };
  } catch (error) {
    console.error('Error generating lead source comparison report:', error);
    throw error;
  }
}


/**
 * Generate comprehensive lead source performance report
 * This is the main report you requested
 */

/**
 * Generate comprehensive lead source performance report
 */
async generateLeadSourcePerformanceReport(tenantId, params) {
  const { 
    startDate, 
    endDate, 
    sources = [], 
    groupBy = 'day',
    closedTag = 'closed',
    contactedStatuses = ['contacted', 'transferred']
  } = params;
  
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const start = moment(startDate).startOf('day');
    const end = moment(endDate).endOf('day');
    
    // Simple version - just get basic counts
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [start.toDate(), end.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    const results = await this.models.Lead.findAll({
      where: whereClause,
      attributes: [
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalLeads']
      ],
      group: ['source'],
      raw: true
    });
    
    return {
      summary: {
        totalNewLeads: results.reduce((sum, r) => sum + parseInt(r.totalLeads), 0),
        totalContactedLeads: 0,
        totalClosedLeads: 0,
        overallContactRate: 0,
        overallCloseRate: 0
      },
      sourcePerformance: results.map(r => ({
        source: r.source,
        newLeads: parseInt(r.totalLeads),
        contactedLeads: 0,
        closedLeads: 0,
        contactRate: 0,
        closeRate: 0,
        contactToCloseRate: 0,
        avgDaysToClose: '0'
      })),
      timeSeries: [],
      conversionFunnel: {
        stages: [],
        conversionRates: {}
      },
      parameters: params
    };
  } catch (error) {
    console.error('Error generating lead source performance report:', error);
    throw error;
  }
}  




/**
 * Get lead time series data based on type
 */
async getLeadTimeSeriesData(tenantId, startDate, endDate, groupBy, sources, type, statuses = null, tag = null) {
  try {
    let dateFormat, groupByClause;
    
    switch (groupBy) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        groupByClause = [this.sequelize.fn('DATE', this.sequelize.col('createdAt'))];
        break;
      case 'week':
        dateFormat = '%Y-Week-%u';
        groupByClause = [this.sequelize.fn('YEARWEEK', this.sequelize.col('createdAt'))];
        break;
      case 'month':
        dateFormat = '%Y-%m';
        groupByClause = [
          this.sequelize.fn('YEAR', this.sequelize.col('createdAt')),
          this.sequelize.fn('MONTH', this.sequelize.col('createdAt'))
        ];
        break;
      default:
        dateFormat = '%Y-%m-%d';
        groupByClause = [this.sequelize.fn('DATE', this.sequelize.col('createdAt'))];
    }
    
    // Build where clause
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [startDate.toDate(), endDate.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    // Add specific conditions based on type
    if (type === 'contacted' && statuses) {
      whereClause.status = { [Op.in]: statuses };
    }
    
    if (type === 'closed' && tag) {
      whereClause.additionalData = {
        [Op.contains]: { tags: [tag] }
      };
    }
    
    const results = await this.models.Lead.findAll({
      where: whereClause,
      attributes: [
        [this.sequelize.fn('DATE_FORMAT', this.sequelize.col('createdAt'), dateFormat), 'period'],
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'count']
      ],
      group: ['period', 'source'],
      order: [['period', 'ASC']],
      raw: true
    });
    
    return results.map(row => ({
      period: row.period,
      source: row.source,
      count: parseInt(row.count),
      type
    }));
  } catch (error) {
    console.error(`Error getting ${type} leads time series:`, error);
    throw error;
  }
}


async getSourcePerformanceSummary(tenantId, startDate, endDate, sources, contactedStatuses, closedTag) {
  try {
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [startDate.toDate(), endDate.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    const results = await this.models.Lead.findAll({
      where: whereClause,
      attributes: [
        'source',
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'newLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN status IN (${contactedStatuses.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END`
        )), 'contactedLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN "additionalData"::jsonb ? 'tags' AND "additionalData"::jsonb->'tags' @> '"${closedTag}"'::jsonb THEN 1 ELSE 0 END`
        )), 'closedLeads'],
        [this.sequelize.fn('AVG', this.sequelize.literal(
          `EXTRACT(EPOCH FROM (COALESCE("updatedAt", NOW()) - "createdAt")) / 86400`
        )), 'avgDaysToClose']
      ],
      group: ['source'],
      order: [[this.sequelize.literal('COUNT("id")'), 'DESC']],
      raw: true
    });
    
    return results.map(row => {
      const newLeads = parseInt(row.newLeads);
      const contactedLeads = parseInt(row.contactedLeads);
      const closedLeads = parseInt(row.closedLeads);
      
      return {
        source: row.source,
        newLeads,
        contactedLeads,
        closedLeads,
        contactRate: this.calculateRate(contactedLeads, newLeads),
        closeRate: this.calculateRate(closedLeads, newLeads),
        contactToCloseRate: this.calculateRate(closedLeads, contactedLeads),
        avgDaysToClose: parseFloat(row.avgDaysToClose || 0).toFixed(1)
      };
    });
  } catch (error) {
    console.error('Error getting source performance summary:', error);
    throw error;
  }
}

/**
 * Get lead conversion funnel
 */
async getLeadConversionFunnel(tenantId, startDate, endDate, sources, contactedStatuses, closedTag) {
  try {
    const whereClause = {
      tenantId,
      createdAt: {
        [Op.between]: [startDate.toDate(), endDate.toDate()]
      }
    };
    
    if (sources.length > 0) {
      whereClause.source = { [Op.in]: sources };
    }
    
    const results = await this.models.Lead.findOne({
      where: whereClause,
      attributes: [
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN status IN (${contactedStatuses.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END`
        )), 'contactedLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(
          `CASE WHEN "additionalData"::jsonb ? 'tags' AND "additionalData"::jsonb->'tags' @> '"${closedTag}"'::jsonb THEN 1 ELSE 0 END`
        )), 'closedLeads']
      ],
      raw: true
    });
    
    const totalLeads = parseInt(results.totalLeads);
    const contactedLeads = parseInt(results.contactedLeads);
    const closedLeads = parseInt(results.closedLeads);
    
    return {
      stages: [
        {
          name: 'New Leads',
          count: totalLeads,
          percentage: 100,
          dropoffFromPrevious: 0
        },
        {
          name: 'Contacted',
          count: contactedLeads,
          percentage: this.calculateRate(contactedLeads, totalLeads),
          dropoffFromPrevious: totalLeads - contactedLeads
        },
        {
          name: 'Closed',
          count: closedLeads,
          percentage: this.calculateRate(closedLeads, totalLeads),
          dropoffFromPrevious: contactedLeads - closedLeads
        }
      ],
      conversionRates: {
        leadToContact: this.calculateRate(contactedLeads, totalLeads),
        leadToClose: this.calculateRate(closedLeads, totalLeads),
        contactToClose: this.calculateRate(closedLeads, contactedLeads)
      }
    };
  } catch (error) {
    console.error('Error getting lead conversion funnel:', error);
    throw error;
  }
}

/**
 * Combine time series data from different types
 */
combineTimeSeriesData(newLeads, contactedLeads, closedLeads, groupBy) {
  const combined = {};
  
  // Process new leads
  newLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].newLeads = item.count;
  });
  
  // Process contacted leads
  contactedLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].contactedLeads = item.count;
  });
  
  // Process closed leads
  closedLeads.forEach(item => {
    const key = `${item.period}_${item.source}`;
    if (!combined[key]) {
      combined[key] = {
        period: item.period,
        source: item.source,
        newLeads: 0,
        contactedLeads: 0,
        closedLeads: 0
      };
    }
    combined[key].closedLeads = item.count;
  });
  
  // Convert to array and add calculated fields
  return Object.values(combined).map(item => ({
    ...item,
    contactRate: this.calculateRate(item.contactedLeads, item.newLeads),
    closeRate: this.calculateRate(item.closedLeads, item.newLeads)
  })).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Calculate percentage rate
 */
calculateRate(numerator, denominator) {
  if (denominator === 0) return 0;
  return parseFloat((numerator / denominator * 100).toFixed(2));
}

/**
 * Get lead source comparison report
 */
async generateLeadSourceComparisonReport(tenantId, params) {
  const { 
    startDate, 
    endDate, 
    compareStartDate,
    compareEndDate,
    sources = [],
    closedTag = 'closed',
    contactedStatuses = ['contacted', 'transferred']
  } = params;
  
  // Ensure tenantId is a string
  tenantId = this.ensureTenantIdString(tenantId);
  
  try {
    const currentPeriod = await this.getSourcePerformanceSummary(
      tenantId,
      moment(startDate),
      moment(endDate),
      sources,
      contactedStatuses,
      closedTag
    );
    
    const previousPeriod = await this.getSourcePerformanceSummary(
      tenantId,
      moment(compareStartDate),
      moment(compareEndDate),
      sources,
      contactedStatuses,
      closedTag
    );
    
    // Create comparison data
    const comparison = currentPeriod.map(current => {
      const previous = previousPeriod.find(p => p.source === current.source) || {
        newLeads: 0, contactedLeads: 0, closedLeads: 0, contactRate: 0, closeRate: 0
      };
      
      return {
        source: current.source,
        current: current,
        previous: previous,
        changes: {
          newLeads: current.newLeads - previous.newLeads,
          contactedLeads: current.contactedLeads - previous.contactedLeads,
          closedLeads: current.closedLeads - previous.closedLeads,
          contactRate: current.contactRate - previous.contactRate,
          closeRate: current.closeRate - previous.closeRate
        },
        percentageChanges: {
          newLeads: this.calculatePercentageChange(current.newLeads, previous.newLeads),
          contactedLeads: this.calculatePercentageChange(current.contactedLeads, previous.contactedLeads),
          closedLeads: this.calculatePercentageChange(current.closedLeads, previous.closedLeads),
          contactRate: this.calculatePercentageChange(current.contactRate, previous.contactRate),
          closeRate: this.calculatePercentageChange(current.closeRate, previous.closeRate)
        }
      };
    });
    
    return {
      comparison,
      summary: {
        totalSources: comparison.length,
        improvingSources: comparison.filter(c => c.changes.newLeads > 0).length,
        decliningSourcees: comparison.filter(c => c.changes.newLeads < 0).length
      },
      parameters: {
        currentPeriod: { startDate, endDate },
        previousPeriod: { startDate: compareStartDate, endDate: compareEndDate },
        sources,
        closedTag,
        contactedStatuses
      }
    };
  } catch (error) {
    console.error('Error generating lead source comparison report:', error);
    throw error;
  }
}
  /**
   * Generate agent performance report
   */
  async generateAgentPerformanceReport(tenantId, params) {
    const { startDate, endDate, agentIds = [] } = params;
    
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      // Get all agents if none specified
      let agents;
      if (agentIds.length > 0) {
        agents = await this.models.User.findAll({
          where: {
            id: agentIds,
            tenantId,
            role: 'agent'
          }
        });
      } else {
        agents = await this.models.User.findAll({
          where: {
            tenantId,
            role: 'agent'
          }
        });
      }
      
      const agentData = [];
      
      for (const agent of agents) {
        // Get call statistics
        const callStats = await this.models.CallLog.findOne({
          where: {
            tenantId,
            agentId: agent.id,
            startTime: {
              [Op.between]: [start.toDate(), end.toDate()]
            }
          },
          attributes: [
            [fn('COUNT', col('id')), 'totalCalls'],
            [fn('SUM', literal(`CASE WHEN status = 'answered' THEN 1 ELSE 0 END`)), 'answeredCalls'],
            [fn('SUM', literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredCalls'],
            [fn('AVG', col('duration')), 'avgDuration'],
            [fn('SUM', col('duration')), 'totalTalkTime'],
            [fn('MAX', col('duration')), 'longestCall']
          ],
          raw: true
        });
        
        // Get SMS statistics
        const smsStats = await this.models.SmsMessage.findOne({
          where: {
            tenantId,
            metadata: {
              agentId: agent.id
            },
            createdAt: {
              [Op.between]: [start.toDate(), end.toDate()]
            }
          },
          attributes: [
            [fn('COUNT', col('id')), 'totalSms'],
            [fn('SUM', literal(`CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END`)), 'sentSms']
          ],
          raw: true
        });
        
        const dailyBreakdown = await this.models.CallLog.findAll({
  where: {
    tenantId,
    agentId: agent.id,
    startTime: {
      [Op.between]: [start.toDate(), end.toDate()]
    }
  },
  attributes: [
    [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('startTime')), 'date'],
    [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'calls'],
    [this.sequelize.fn('SUM', this.sequelize.col('duration')), 'talkTime']
  ],
  group: [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('startTime'))],
  order: [[this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('startTime')), 'ASC']],
  raw: true
});
        
        agentData.push({
          agent: {
            id: agent.id,
            username: agent.username,
            email: agent.email
          },
          metrics: {
            ...callStats,
            ...smsStats,
            connectionRate: callStats.totalCalls > 0
              ? (callStats.answeredCalls / callStats.totalCalls * 100).toFixed(2)
              : 0,
            transferRate: callStats.answeredCalls > 0
              ? (callStats.transferredCalls / callStats.answeredCalls * 100).toFixed(2)
              : 0
          },
          dailyBreakdown
        });
      }
      
      // Sort by total calls descending
      agentData.sort((a, b) => (b.metrics.totalCalls || 0) - (a.metrics.totalCalls || 0));
      
      // Calculate team totals
      const teamTotals = agentData.reduce((totals, agent) => {
        totals.totalCalls += parseInt(agent.metrics.totalCalls || 0);
        totals.answeredCalls += parseInt(agent.metrics.answeredCalls || 0);
        totals.transferredCalls += parseInt(agent.metrics.transferredCalls || 0);
        totals.totalTalkTime += parseInt(agent.metrics.totalTalkTime || 0);
        totals.totalSms += parseInt(agent.metrics.totalSms || 0);
        return totals;
      }, {
        totalCalls: 0,
        answeredCalls: 0,
        transferredCalls: 0,
        totalTalkTime: 0,
        totalSms: 0
      });
      
      teamTotals.avgTalkTime = teamTotals.totalCalls > 0
        ? teamTotals.totalTalkTime / teamTotals.totalCalls
        : 0;
      
      return {
        agents: agentData,
        teamTotals,
        parameters: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          agentIds
        }
      };
    } catch (error) {
      console.error('Error generating agent performance report:', error);
      throw error;
    }
  }

  /**
   * Generate lead conversion report
   */
  async generateLeadConversionReport(tenantId, params) {
    const { startDate, endDate, sources = [], brands = [] } = params;
    
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      // Base query
      const whereClause = {
        tenantId,
        createdAt: {
          [Op.between]: [start.toDate(), end.toDate()]
        }
      };
      
      if (sources.length > 0) whereClause.source = sources;
      if (brands.length > 0) whereClause.brand = brands;
      
      // Get lead funnel data
      const funnelData = await this.models.Lead.findOne({
        where: whereClause,
        attributes: [
          [fn('COUNT', col('id')), 'totalLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'contacted' THEN 1 ELSE 0 END`)), 'contactedLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), 'completedLeads']
        ],
        raw: true
      });
      
      // Get conversion by source
      const conversionBySource = await this.models.Lead.findAll({
        where: whereClause,
        attributes: [
          'source',
          [fn('COUNT', col('id')), 'totalLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'contacted' THEN 1 ELSE 0 END`)), 'contactedLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), 'completedLeads']
        ],
        group: ['source'],
        order: [[fn('COUNT', col('id')), 'DESC']],
        raw: true
      });
      
      // Calculate conversion rates
      conversionBySource.forEach(source => {
        source.contactRate = source.totalLeads > 0
          ? (source.contactedLeads / source.totalLeads * 100).toFixed(2)
          : 0;
        source.transferRate = source.contactedLeads > 0
          ? (source.transferredLeads / source.contactedLeads * 100).toFixed(2)
          : 0;
        source.completionRate = source.totalLeads > 0
          ? (source.completedLeads / source.totalLeads * 100).toFixed(2)
          : 0;
      });
      
      // Get conversion by brand
      const conversionByBrand = await this.models.Lead.findAll({
        where: whereClause,
        attributes: [
          'brand',
          [fn('COUNT', col('id')), 'totalLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'contacted' THEN 1 ELSE 0 END`)), 'contactedLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredLeads'],
          [fn('SUM', literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), 'completedLeads']
        ],
        group: ['brand'],
        order: [[fn('COUNT', col('id')), 'DESC']],
        raw: true
      });
      
      // Calculate conversion rates
      conversionByBrand.forEach(brand => {
        brand.contactRate = brand.totalLeads > 0
          ? (brand.contactedLeads / brand.totalLeads * 100).toFixed(2)
          : 0;
        brand.transferRate = brand.contactedLeads > 0
          ? (brand.transferredLeads / brand.contactedLeads * 100).toFixed(2)
          : 0;
        brand.completionRate = brand.totalLeads > 0
          ? (brand.completedLeads / brand.totalLeads * 100).toFixed(2)
          : 0;
      });
      
      // Get time to contact metrics
      const timeToContactData = await this.sequelize.query(`
        SELECT 
          AVG(TIMESTAMPDIFF(MINUTE, l.createdAt, c.startTime)) as avgTimeToFirstContact,
          MIN(TIMESTAMPDIFF(MINUTE, l.createdAt, c.startTime)) as minTimeToFirstContact,
          MAX(TIMESTAMPDIFF(MINUTE, l.createdAt, c.startTime)) as maxTimeToFirstContact
        FROM Leads l
        INNER JOIN CallLogs c ON l.id = c.leadId
        WHERE l.tenantId = :tenantId
          AND l.createdAt BETWEEN :startDate AND :endDate
          AND c.status = 'answered'
          AND c.id = (
            SELECT id FROM CallLogs 
            WHERE leadId = l.id AND status = 'answered' 
            ORDER BY startTime ASC 
            LIMIT 1
          )
      `, {
        replacements: {
          tenantId,
          startDate: start.toDate(),
          endDate: end.toDate()
        },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      // Get daily conversion trend
      const dailyTrend = await this.models.Lead.findAll({
  where: whereClause,
  attributes: [
    [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('createdAt')), 'date'],
    [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'newLeads'],
    [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'contacted' THEN 1 ELSE 0 END`)), 'contacted'],
    [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferred']
  ],
  group: [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('createdAt'))],
  order: [[this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('createdAt')), 'ASC']],
  raw: true
});
      
      return {
        funnel: {
          ...funnelData,
          contactRate: funnelData.totalLeads > 0
            ? (funnelData.contactedLeads / funnelData.totalLeads * 100).toFixed(2)
            : 0,
          transferRate: funnelData.contactedLeads > 0
            ? (funnelData.transferredLeads / funnelData.contactedLeads * 100).toFixed(2)
            : 0,
          completionRate: funnelData.totalLeads > 0
            ? (funnelData.completedLeads / funnelData.totalLeads * 100).toFixed(2)
            : 0
        },
        bySource: conversionBySource,
        byBrand: conversionByBrand,
        timeToContact: timeToContactData[0] || {},
        dailyTrend,
        parameters: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          sources,
          brands
        }
      };
    } catch (error) {
      console.error('Error generating lead conversion report:', error);
      throw error;
    }
  }



/**
   * Generate journey analytics report
   */
/**
   * Generate journey analytics report
   */
  async generateJourneyAnalyticsReport(tenantId, params) {
    const { startDate, endDate, journeyIds = [] } = params;
    
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      // Get journeys
      const journeyQuery = { tenantId };
      if (journeyIds.length > 0) {
        journeyQuery.id = journeyIds;
      }
      
      const journeys = await this.models.Journey.findAll({
        where: journeyQuery,
        include: [{
          model: this.models.JourneyStep,
          as: 'steps'
        }]
      });
      
      const journeyAnalytics = [];
      
      for (const journey of journeys) {
        // Get enrollment stats
        const enrollmentStats = await this.models.LeadJourney.findOne({
          where: {
            journeyId: journey.id,
            startedAt: {
              [Op.between]: [start.toDate(), end.toDate()]
            }
          },
          attributes: [
            [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalEnrollments'],
            [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'active' THEN 1 ELSE 0 END`)), 'activeEnrollments'],
            [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), 'completedEnrollments'],
            [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'exited' THEN 1 ELSE 0 END`)), 'exitedEnrollments']
          ],
          raw: true
        });
        
        // Get step execution stats
        const stepStats = {};
        for (const step of journey.steps) {
          const execStats = await this.models.JourneyExecution.findOne({
            where: {
              stepId: step.id,
              createdAt: {
                [Op.between]: [start.toDate(), end.toDate()]
              }
            },
            attributes: [
              [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalExecutions'],
              [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), 'completedExecutions']
              // Removed AVG(executionTime) as this field doesn't exist
            ],
            raw: true
          });
          
          stepStats[step.id] = {
            stepName: step.name,
            totalExecutions: parseInt(execStats.totalExecutions || 0),
            completedExecutions: parseInt(execStats.completedExecutions || 0),
            successRate: execStats.totalExecutions > 0
              ? (execStats.completedExecutions / execStats.totalExecutions * 100).toFixed(2)
              : 0
          };
        }
        
        // Get conversion funnel
        const conversionFunnel = await this.sequelize.query(`
          SELECT 
            COUNT(DISTINCT lj."leadId") as "uniqueLeads",
            COUNT(DISTINCT CASE WHEN je."stepId" = :firstStepId THEN lj."leadId" END) as "reachedFirstStep",
            COUNT(DISTINCT CASE WHEN je."stepId" = :lastStepId THEN lj."leadId" END) as "reachedLastStep",
            COUNT(DISTINCT CASE WHEN lj.status = 'completed' THEN lj."leadId" END) as completed
          FROM "LeadJourneys" lj
          LEFT JOIN "JourneyExecutions" je ON lj.id = je."leadJourneyId"
          WHERE lj."journeyId" = :journeyId
            AND lj."startedAt" BETWEEN :startDate AND :endDate
        `, {
          replacements: {
            journeyId: journey.id,
            firstStepId: journey.steps[0]?.id,
            lastStepId: journey.steps[journey.steps.length - 1]?.id,
            startDate: start.toDate(),
            endDate: end.toDate()
          },
          type: this.sequelize.QueryTypes.SELECT
        });
        
        const enrollmentCount = parseInt(enrollmentStats.totalEnrollments || 0);
        const completedCount = parseInt(enrollmentStats.completedEnrollments || 0);
        
        journeyAnalytics.push({
          journey: {
            id: journey.id,
            name: journey.name,
            description: journey.description,
            stepCount: journey.steps.length
          },
          enrollments: {
            totalEnrollments: enrollmentCount,
            activeEnrollments: parseInt(enrollmentStats.activeEnrollments || 0),
            completedEnrollments: completedCount,
            exitedEnrollments: parseInt(enrollmentStats.exitedEnrollments || 0)
          },
          stepPerformance: stepStats,
          conversionFunnel: conversionFunnel[0],
          conversionRate: enrollmentCount > 0
            ? (completedCount / enrollmentCount * 100).toFixed(2)
            : 0
        });
      }
      
      return {
        journeys: journeyAnalytics,
        parameters: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          journeyIds
        }
      };
    } catch (error) {
      console.error('Error generating journey analytics report:', error);
      throw error;
    }
  }





  /**
   * Generate custom report
   */
  async generateCustomReport(tenantId, config) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const { query, parameters = {} } = config;
      
      // Validate and sanitize query
      if (!this.isQuerySafe(query)) {
        throw new Error('Invalid query: potential security risk');
      }
      
      // Add tenant filter
      parameters.tenantId = tenantId;
      
      // Execute query
      const results = await this.sequelize.query(query, {
        replacements: parameters,
        type: this.sequelize.QueryTypes.SELECT
      });
      
      return {
        data: results,
        rowCount: results.length,
        parameters
      };
    } catch (error) {
      console.error('Error generating custom report:', error);
      throw error;
    }
  }

  /**
   * Export report to file
   */
  async exportReport(reportData, format, filename) {
    try {
      const exportDir = path.join(__dirname, '../exports');
      await fs.mkdir(exportDir, { recursive: true });
      
      const filepath = path.join(exportDir, `${filename}.${format}`);
      
      switch (format) {
        case 'csv':
          await this.exportToCsv(reportData, filepath);
          break;
          
        case 'excel':
          await this.exportToExcel(reportData, filepath);
          break;
          
        case 'pdf':
          await this.exportToPdf(reportData, filepath);
          break;
          
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
      
      return filepath;
    } catch (error) {
      console.error('Error exporting report:', error);
      throw error;
    }
  }

  /**
   * Export to CSV
   */
  async exportToCsv(data, filepath) {
    const createCsvWriter = require('csv-writer').createObjectCsvWriter;
    
    if (!data.data || data.data.length === 0) {
      throw new Error('No data to export');
    }
    
    const headers = Object.keys(data.data[0]).map(key => ({
      id: key,
      title: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')
    }));
    
    const csvWriter = createCsvWriter({
      path: filepath,
      header: headers
    });
    
    await csvWriter.writeRecords(data.data);
  }

  /**
   * Export to Excel
   */
  async exportToExcel(data, filepath) {
    const workbook = new ExcelJS.Workbook();
    
    // Add summary sheet if available
    if (data.summary) {
      const summarySheet = workbook.addWorksheet('Summary');
      
      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 }
      ];
      
      Object.entries(data.summary).forEach(([key, value]) => {
        summarySheet.addRow({
          metric: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
          value: value
        });
      });
    }
    
    // Add data sheet
    if (data.data && data.data.length > 0) {
      const dataSheet = workbook.addWorksheet('Data');
      
      // Set columns
      const columns = Object.keys(data.data[0]).map(key => ({
        header: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
        key: key,
        width: 15
      }));
      
      dataSheet.columns = columns;
      
      // Add rows
      data.data.forEach(row => {
        dataSheet.addRow(row);
      });
      
      // Style header row
      dataSheet.getRow(1).font = { bold: true };
      dataSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
    }
    
    await workbook.xlsx.writeFile(filepath);
  }

  /**
   * Export to PDF
   */
  async exportToPdf(data, filepath) {
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(filepath);
    
    doc.pipe(stream);
    
    // Add title
    doc.fontSize(20).text('Report', 50, 50);
    doc.fontSize(10).text(`Generated: ${moment().format('YYYY-MM-DD HH:mm:ss')}`, 50, 80);
    
    // Add summary if available
    if (data.summary) {
      doc.fontSize(14).text('Summary', 50, 120);
      let y = 150;
      
      Object.entries(data.summary).forEach(([key, value]) => {
        doc.fontSize(10).text(
          `${key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}: ${value}`,
          50,
          y
        );
        y += 20;
      });
    }
    
    // Add data table (simplified)
    if (data.data && data.data.length > 0) {
      doc.addPage();
      doc.fontSize(14).text('Data', 50, 50);
      
      // This is a simplified table - in production, use a proper PDF table library
      let y = 80;
      const headers = Object.keys(data.data[0]);
      
      // Headers
      doc.fontSize(10).font('Helvetica-Bold');
      headers.forEach((header, i) => {
        doc.text(header, 50 + (i * 100), y, { width: 90, align: 'left' });
      });
      
      y += 20;
      doc.font('Helvetica');
      
      // Data rows (limit to prevent overflow)
      data.data.slice(0, 20).forEach(row => {
        headers.forEach((header, i) => {
          doc.text(String(row[header] || ''), 50 + (i * 100), y, { width: 90, align: 'left' });
        });
        y += 20;
        
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
      });
      
      if (data.data.length > 20) {
        doc.text(`... and ${data.data.length - 20} more rows`, 50, y + 20);
      }
    }
    
    doc.end();
    
    return new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
  }

  /**
   * Schedule a report
   */
  async scheduleReport(tenantId, templateId, schedule) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const template = await this.models.ReportTemplate.findOne({
        where: { id: templateId, tenantId }
      });
      
      if (!template) {
        throw new Error('Report template not found');
      }
      
      await template.update({ schedule });
      
      return {
        success: true,
        message: 'Report scheduled successfully'
      };
    } catch (error) {
      console.error('Error scheduling report:', error);
      throw error;
    }
  }

  /**
   * Execute scheduled reports
   */
async executeScheduledReports() {
  try {
    const now = moment();
    const currentTime = now.format('HH:mm');
    const currentDay = now.format('dddd').toLowerCase();
    
    // Fix: Use proper JSONB query syntax for PostgreSQL
    const reports = await this.models.ReportTemplate.findAll({
      where: {
        isActive: true,
        [Op.and]: [
          this.sequelize.literal(`"schedule"->>'enabled' = 'true'`),
          this.sequelize.literal(`"schedule"->>'time' = '${currentTime}'`)
        ]
      }
    });
    
    for (const report of reports) {
      try {
        // Check frequency
        const { frequency } = report.schedule;
        let shouldRun = false;
        
        if (frequency === 'daily') {
          shouldRun = true;
        } else if (frequency === 'weekly' && currentDay === 'monday') {
          shouldRun = true;
        } else if (frequency === 'monthly' && now.date() === 1) {
          shouldRun = true;
        }
        
        if (!shouldRun) continue;
        
        // Generate report
        let reportData;
        switch (report.type) {
          case 'call_summary':
            reportData = await this.generateCallSummaryReport(report.tenantId, {
              startDate: now.clone().subtract(1, 'day').format('YYYY-MM-DD'),
              endDate: now.format('YYYY-MM-DD'),
              ...report.config.filters
            });
            break;
          case 'sms_summary':
            reportData = await this.generateSmsSummaryReport(report.tenantId, {
              startDate: now.clone().subtract(1, 'day').format('YYYY-MM-DD'),
              endDate: now.format('YYYY-MM-DD'),
              ...report.config.filters
            });
            break;
          case 'agent_performance':
            reportData = await this.generateAgentPerformanceReport(report.tenantId, {
              startDate: now.clone().subtract(1, 'day').format('YYYY-MM-DD'),
              endDate: now.format('YYYY-MM-DD'),
              ...report.config.filters
            });
            break;
          case 'lead_conversion':
            reportData = await this.generateLeadConversionReport(report.tenantId, {
              startDate: now.clone().subtract(1, 'day').format('YYYY-MM-DD'),
              endDate: now.format('YYYY-MM-DD'),
              ...report.config.filters
            });
            break;
          case 'journey_analytics':
            reportData = await this.generateJourneyAnalyticsReport(report.tenantId, {
              startDate: now.clone().subtract(1, 'day').format('YYYY-MM-DD'),
              endDate: now.format('YYYY-MM-DD'),
              ...report.config.filters
            });
            break;
          default:
            console.warn(`Unsupported report type: ${report.type}`);
            continue;
        }
        
        // Export report
        const filename = `${report.name}_${now.format('YYYY-MM-DD')}`;
        const filepath = await this.exportReport(reportData, report.schedule.format, filename);
        
        // Send to recipients
        await this.sendReportEmail(report, filepath);
        
      } catch (error) {
        console.error(`Error executing scheduled report ${report.id}:`, error);
      }
    }
  } catch (error) {
    console.error('Error executing scheduled reports:', error);
    throw error;
  }
}



  /**
   * Update real-time dashboard stats
   */
  async updateDashboardStats(tenantId) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const now = moment();
      const todayStart = now.clone().startOf('day');
      
      // Get active calls
      const activeCalls = await this.models.CallLog.count({
        where: {
          tenantId,
          status: {
            [Op.in]: ['initiated', 'answered']
          },
          endTime: null
        }
      });
      
      // Get today's metrics
      const todaysCalls = await this.models.CallLog.count({
        where: {
          tenantId,
          startTime: { [Op.gte]: todayStart.toDate() }
        }
      });
      
      const todaysSms = await this.models.SmsMessage.count({
        where: {
          tenantId,
          createdAt: { [Op.gte]: todayStart.toDate() }
        }
      });
      
      const todaysLeads = await this.models.Lead.count({
        where: {
          tenantId,
          createdAt: { [Op.gte]: todayStart.toDate() }
        }
      });
      
      // Get active journeys count using raw query to avoid association issues
      const activeJourneysResult = await this.sequelize.query(`
        SELECT COUNT(*) as count
        FROM "LeadJourneys" lj
        INNER JOIN "Journeys" j ON lj."journeyId" = j.id
        WHERE lj.status = 'active' AND j."tenantId" = :tenantId
      `, {
        replacements: { tenantId },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      const activeJourneys = parseInt(activeJourneysResult[0].count) || 0;
      
      // Get agent status from external API or cache
      // This is a placeholder - implement based on your agent system
      const availableAgents = 0;
      const busyAgents = 0;
      
      // Create or update snapshot
      await this.models.DashboardSnapshot.create({
        tenantId,
        timestamp: now.toDate(),
        stats: {
          activeCalls,
          waitingCalls: 0, // Implement based on your queue system
          availableAgents,
          busyAgents,
          todaysCalls,
          todaysSms,
          todaysLeads,
          activeJourneys
        }
      });
      
      // Clean up old snapshots (keep last 24 hours)
      const cutoff = now.clone().subtract(24, 'hours');
      await this.models.DashboardSnapshot.destroy({
        where: {
          tenantId,
          timestamp: { [Op.lt]: cutoff.toDate() }
        }
      });
      
      return {
        activeCalls,
        availableAgents,
        busyAgents,
        todaysCalls,
        todaysSms,
        todaysLeads,
        activeJourneys
      };
    } catch (error) {
      console.error('Error updating dashboard stats:', error);
      throw error;
    }
  }



  /**
   * Get real-time dashboard statistics
   */
  async getDashboardLiveStats(tenantId) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const now = moment();
      const todayStart = now.clone().startOf('day');
      
      // Get real-time metrics
      const [
        activeCalls,
        todaysCalls,
        todaysSms,
        todaysLeads,
        agentStatus
      ] = await Promise.all([
        // Active calls
        this.models.CallLog.count({
          where: {
            tenantId,
            status: { [Op.in]: ['initiated', 'answered'] },
            endTime: null
          }
        }),
        
        // Today's calls
        this.models.CallLog.count({
          where: {
            tenantId,
            startTime: { [Op.gte]: todayStart.toDate() }
          }
        }),
        
        // Today's SMS
        this.models.SmsMessage?.count({
          where: {
            tenantId,
            createdAt: { [Op.gte]: todayStart.toDate() }
          }
        }) || 0,
        
        // Today's leads
        this.models.Lead.count({
          where: {
            tenantId,
            createdAt: { [Op.gte]: todayStart.toDate() }
          }
        }),
        
        // Agent status (mock for now)
        this.getAgentStatus(tenantId)
      ]);
      
      // Get active journeys count using raw query to avoid association issues
      const activeJourneysResult = await this.sequelize.query(`
        SELECT COUNT(*) as count
        FROM "LeadJourneys" lj
        INNER JOIN "Journeys" j ON lj."journeyId" = j.id
        WHERE lj.status = 'active' AND j."tenantId" = :tenantId
      `, {
        replacements: { tenantId },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      const activeJourneys = parseInt(activeJourneysResult[0].count) || 0;
      
      // Calculate additional metrics
      const [
        todaysTransfers,
        todaysConversions,
        avgCallDuration,
        avgResponseTime
      ] = await Promise.all([
        // Today's transfers
        this.models.CallLog.count({
          where: {
            tenantId,
            status: 'transferred',
            startTime: { [Op.gte]: todayStart.toDate() }
          }
        }),
        
        // Today's conversions
        this.models.Lead.count({
          where: {
            tenantId,
            status: 'completed',
            updatedAt: { [Op.gte]: todayStart.toDate() }
          }
        }),
        
        // Average call duration today
        this.models.CallLog.findOne({
          where: {
            tenantId,
            startTime: { [Op.gte]: todayStart.toDate() },
            duration: { [Op.ne]: null }
          },
          attributes: [[this.sequelize.fn('AVG', this.sequelize.col('duration')), 'avgDuration']],
          raw: true
        }),
        
        // Average response time (mock)
        { avgTime: 45 }
      ]);
      
      // Calculate rates
      const transferRate = todaysCalls > 0 ? (todaysTransfers / todaysCalls * 100).toFixed(2) : 0;
      const conversionRate = todaysLeads > 0 ? (todaysConversions / todaysLeads * 100).toFixed(2) : 0;
      
      // Get trend data (compare to yesterday)
      const yesterdayStart = todayStart.clone().subtract(1, 'day');
      const yesterdayEnd = yesterdayStart.clone().endOf('day');
      
      const yesterdaysCalls = await this.models.CallLog.count({
        where: {
          tenantId,
          startTime: { [Op.between]: [yesterdayStart.toDate(), yesterdayEnd.toDate()] }
        }
      });
      
      const callsTrend = yesterdaysCalls > 0 
        ? ((todaysCalls - yesterdaysCalls) / yesterdaysCalls * 100).toFixed(2)
        : 0;
      
      return {
        realtime: {
          activeCalls,
          waitingCalls: agentStatus.waitingCalls || 0,
          availableAgents: agentStatus.availableAgents || 0,
          busyAgents: agentStatus.busyAgents || 0
        },
        today: {
          calls: todaysCalls,
          sms: todaysSms,
          leads: todaysLeads,
          transfers: todaysTransfers,
          conversions: todaysConversions,
          activeJourneys
        },
        metrics: {
          avgCallDuration: avgCallDuration?.avgDuration || 0,
          avgResponseTime: avgResponseTime.avgTime,
          transferRate,
          conversionRate
        },
        trends: {
          calls: callsTrend,
          sms: 0, // Calculate if needed
          leads: 0, // Calculate if needed
          conversions: 0 // Calculate if needed
        },
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('Error getting dashboard live stats:', error);
      throw error;
    }
  }

  /**
   * Get historical dashboard data
   */
  async getDashboardHistoricalData(tenantId, params) {
    const { period = '7days', metrics = ['calls', 'leads', 'conversions'] } = params;
    
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      let startDate, endDate, groupBy;
      
      switch (period) {
        case 'today':
          startDate = moment().startOf('day');
          endDate = moment().endOf('day');
          groupBy = 'hour';
          break;
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
          startDate = moment().subtract(7, 'days').startOf('day');
          endDate = moment().endOf('day');
          groupBy = 'day';
      }
      
      const data = {};
      
      // Get calls data
      if (metrics.includes('calls')) {
        data.calls = await this.getMetricTimeSeries(
          'CallLog',
          'startTime',
          startDate,
          endDate,
          groupBy,
          { tenantId }
        );
      }
      
      // Get leads data
      if (metrics.includes('leads')) {
        data.leads = await this.getMetricTimeSeries(
          'Lead',
          'createdAt',
          startDate,
          endDate,
          groupBy,
          { tenantId }
        );
      }
      
      // Get conversions data
      if (metrics.includes('conversions')) {
        data.conversions = await this.getMetricTimeSeries(
          'Lead',
          'updatedAt',
          startDate,
          endDate,
          groupBy,
          { tenantId, status: 'completed' }
        );
      }
      
      // Get SMS data if available
      if (metrics.includes('sms') && this.models.SmsMessage) {
        data.sms = await this.getMetricTimeSeries(
          'SmsMessage',
          'createdAt',
          startDate,
          endDate,
          groupBy,
          { tenantId }
        );
      }
      
      return {
        period,
        startDate: startDate.format('YYYY-MM-DD'),
        endDate: endDate.format('YYYY-MM-DD'),
        groupBy,
        data
      };
    } catch (error) {
      console.error('Error getting dashboard historical data:', error);
      throw error;
    }
  }

  /**
   * Get journey overview report
   */
  async getJourneyOverviewReport(tenantId, params) {
    const { journeyIds = [], startDate, endDate, compareEnabled = false } = params;
    
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      // Build journey query
      const journeyQuery = { tenantId };
      if (journeyIds.length > 0) {
        journeyQuery.id = journeyIds;
      }
      
      const journeys = await this.models.Journey.findAll({
        where: journeyQuery,
        include: [{
          model: this.models.JourneyStep,
          as: 'steps'
        }]
      });
      
      const overviewData = [];
      
      for (const journey of journeys) {
        // Get enrollment metrics
        const metrics = await this.getJourneyMetrics(journey.id, start, end);
        
        // Get step performance
        const stepPerformance = await this.getJourneyStepPerformance(journey.id, start, end);
        
        // Get conversion funnel
        const funnel = await this.getJourneyConversionFunnel(journey.id, start, end);
        
        const overview = {
          journey: {
            id: journey.id,
            name: journey.name,
            description: journey.description,
            isActive: journey.isActive,
            stepCount: journey.steps.length
          },
          metrics,
          stepPerformance,
          funnel
        };
        
        // Add comparison data if enabled
        if (compareEnabled) {
          const compareStart = start.clone().subtract(end.diff(start), 'milliseconds');
          const compareEnd = start.clone().subtract(1, 'day');
          
          overview.comparison = {
            metrics: await this.getJourneyMetrics(journey.id, compareStart, compareEnd),
            change: this.calculatePercentageChange(
              overview.metrics.totalEnrollments,
              (await this.getJourneyMetrics(journey.id, compareStart, compareEnd)).totalEnrollments
            )
          };
        }
        
        overviewData.push(overview);
      }
      
      return {
        journeys: overviewData,
        summary: this.calculateJourneySummary(overviewData),
        parameters: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          journeyIds,
          compareEnabled
        }
      };
    } catch (error) {
      console.error('Error getting journey overview report:', error);
      throw error;
    }
  }

  /**
   * Get journey funnel visualization data
   */
  async getJourneyFunnelData(tenantId, journeyId, params) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const { startDate, endDate } = params;
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      // Get journey with steps
      const journey = await this.models.Journey.findOne({
        where: { id: journeyId, tenantId },
        include: [{
          model: this.models.JourneyStep,
          as: 'steps',
          order: [['stepOrder', 'ASC']]
        }]
      });
      
      if (!journey) {
        throw new Error('Journey not found');
      }
      
      // Get funnel data for each step
      const funnelData = [];
      let previousStepLeads = null;
      
      for (const step of journey.steps) {
        const stepData = await this.sequelize.query(`
          SELECT 
            COUNT(DISTINCT lj."leadId") as "uniqueLeads",
            COUNT(je.id) as "executions",
            COUNT(CASE WHEN je.status = 'completed' THEN 1 END) as "completions"
          FROM "LeadJourneys" lj
          LEFT JOIN "JourneyExecutions" je ON lj.id = je."leadJourneyId" AND je."stepId" = :stepId
          WHERE lj."journeyId" = :journeyId
            AND lj."startedAt" BETWEEN :startDate AND :endDate
        `, {
          replacements: {
            journeyId: journey.id,
            stepId: step.id,
            startDate: start.toDate(),
            endDate: end.toDate()
          },
          type: this.sequelize.QueryTypes.SELECT
        });
        
        const currentStepLeads = parseInt(stepData[0].uniqueLeads);
        const dropoff = previousStepLeads !== null 
          ? previousStepLeads - currentStepLeads 
          : 0;
        const dropoffRate = previousStepLeads !== null && previousStepLeads > 0
          ? (dropoff / previousStepLeads * 100).toFixed(2)
          : 0;
        
        funnelData.push({
          step: {
            id: step.id,
            name: step.name,
            order: step.stepOrder,
            actionType: step.actionType
          },
          metrics: {
            uniqueLeads: currentStepLeads,
            executions: parseInt(stepData[0].executions),
            completions: parseInt(stepData[0].completions),
            completionRate: stepData[0].executions > 0
              ? (stepData[0].completions / stepData[0].executions * 100).toFixed(2)
              : 0,
            dropoff,
            dropoffRate
          }
        });
        
        previousStepLeads = currentStepLeads;
      }
      
      return {
        journey: {
          id: journey.id,
          name: journey.name
        },
        funnel: funnelData,
        summary: {
          totalEntered: funnelData[0]?.metrics.uniqueLeads || 0,
          totalCompleted: funnelData[funnelData.length - 1]?.metrics.uniqueLeads || 0,
          overallConversionRate: funnelData[0]?.metrics.uniqueLeads > 0
            ? (funnelData[funnelData.length - 1]?.metrics.uniqueLeads / funnelData[0]?.metrics.uniqueLeads * 100).toFixed(2)
            : 0
        }
      };
    } catch (error) {
      console.error('Error getting journey funnel data:', error);
      throw error;
    }
  }

  /**
   * Get lead generation source performance report
   */
  async getLeadGenSourceReport(tenantId, params) {
    const { startDate, endDate, sources = [], groupBy = 'source' } = params;
    
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      // Build query
      const whereClause = {
        tenantId,
        createdAt: {
          [Op.between]: [start.toDate(), end.toDate()]
        }
      };
      
      if (sources.length > 0) {
        whereClause.source = sources;
      }
      
      // Get source performance data
      const sourceData = await this.models.Lead.findAll({
        where: whereClause,
        attributes: [
          groupBy,
          [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalLeads'],
          [this.sequelize.fn('COUNT', this.sequelize.fn('DISTINCT', this.sequelize.col('phone'))), 'uniqueLeads'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'contacted' THEN 1 ELSE 0 END`)), 'contactedLeads'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredLeads'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), 'convertedLeads']
        ],
        group: [groupBy],
        raw: true
      });
      
      // Calculate additional metrics and get cost data
      const enhancedData = await Promise.all(sourceData.map(async (source) => {
        // Get quality metrics
        const qualityMetrics = await this.calculateLeadQualityMetrics(
          tenantId,
          source[groupBy],
          start,
          end
        );
        
        // Get cost data if available
        const costData = await this.getLeadSourceCostData(
          tenantId,
          source[groupBy],
          start,
          end
        );
        
        const contactRate = source.totalLeads > 0
          ? (source.contactedLeads / source.totalLeads * 100).toFixed(2)
          : 0;
        
        const conversionRate = source.totalLeads > 0
          ? (source.convertedLeads / source.totalLeads * 100).toFixed(2)
          : 0;
        
        const costPerLead = costData.totalCost > 0 && source.totalLeads > 0
          ? (costData.totalCost / source.totalLeads).toFixed(2)
          : 0;
        
        const roi = costData.totalCost > 0 && costData.revenue > 0
          ? ((costData.revenue - costData.totalCost) / costData.totalCost * 100).toFixed(2)
          : 0;
        
        return {
          [groupBy]: source[groupBy],
          metrics: {
            totalLeads: parseInt(source.totalLeads),
            uniqueLeads: parseInt(source.uniqueLeads),
            contactedLeads: parseInt(source.contactedLeads),
            transferredLeads: parseInt(source.transferredLeads),
            convertedLeads: parseInt(source.convertedLeads),
            contactRate,
            conversionRate,
            ...qualityMetrics
          },
          cost: {
            totalCost: costData.totalCost,
            costPerLead,
            revenue: costData.revenue,
            roi
          }
        };
      }));
      
      // Get time series data
      const timeSeries = await this.getLeadGenTimeSeries(
        tenantId,
        start,
        end,
        sources,
        groupBy
      );
      
      return {
        sources: enhancedData,
        timeSeries,
        summary: this.calculateLeadGenSummary(enhancedData),
        parameters: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          sources,
          groupBy
        }
      };
    } catch (error) {
      console.error('Error getting lead gen source report:', error);
      throw error;
    }
  }

  /**
   * Get lead quality scoring report
   */
  async getLeadQualityReport(tenantId, params) {
    const { startDate, endDate, minScore = 0, maxScore = 100 } = params;
    
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const start = moment(startDate).startOf('day');
      const end = moment(endDate).endOf('day');
      
      // Get leads with quality scores
      const leads = await this.sequelize.query(`
        SELECT 
          l.id,
          l.source,
          l.brand,
          l.status,
          l."createdAt",
          COUNT(c.id) as "callCount",
          AVG(c.duration) as "avgCallDuration",
          MAX(c.duration) as "maxCallDuration",
          CASE 
            WHEN l.email IS NOT NULL THEN 10 ELSE 0 
          END +
          CASE 
            WHEN l.status = 'completed' THEN 30
            WHEN l.status = 'transferred' THEN 20
            WHEN l.status = 'contacted' THEN 10
            ELSE 0
          END +
          CASE 
            WHEN COUNT(c.id) > 0 THEN 20 ELSE 0
          END +
          CASE 
            WHEN AVG(c.duration) > 300 THEN 20
            WHEN AVG(c.duration) > 120 THEN 10
            ELSE 0
          END as "qualityScore"
        FROM "Leads" l
        LEFT JOIN "CallLogs" c ON l.id = c."leadId"
        WHERE l."tenantId" = :tenantId
          AND l."createdAt" BETWEEN :startDate AND :endDate
        GROUP BY l.id
        HAVING 
          CASE 
            WHEN l.email IS NOT NULL THEN 10 ELSE 0 
          END +
          CASE 
            WHEN l.status = 'completed' THEN 30
            WHEN l.status = 'transferred' THEN 20
            WHEN l.status = 'contacted' THEN 10
            ELSE 0
          END +
          CASE 
            WHEN COUNT(c.id) > 0 THEN 20 ELSE 0
          END +
          CASE 
            WHEN AVG(c.duration) > 300 THEN 20
            WHEN AVG(c.duration) > 120 THEN 10
            ELSE 0
          END BETWEEN :minScore AND :maxScore
      `, {
        replacements: {
          tenantId,
          startDate: start.toDate(),
          endDate: end.toDate(),
          minScore,
          maxScore
        },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      // Calculate score distribution
      const scoreRanges = [
        { min: 0, max: 20, label: 'Very Low' },
        { min: 21, max: 40, label: 'Low' },
        { min: 41, max: 60, label: 'Medium' },
        { min: 61, max: 80, label: 'High' },
        { min: 81, max: 100, label: 'Very High' }
      ];
      
      const distribution = scoreRanges.map(range => ({
        ...range,
        count: leads.filter(l => l.qualityScore >= range.min && l.qualityScore <= range.max).length
      }));
      
      // Calculate quality metrics by source
      const qualityBySource = await this.sequelize.query(`
        SELECT 
          l.source,
          COUNT(l.id) as "totalLeads",
          AVG(
            CASE 
              WHEN l.email IS NOT NULL THEN 10 ELSE 0 
            END +
            CASE 
              WHEN l.status = 'completed' THEN 30
              WHEN l.status = 'transferred' THEN 20
              WHEN l.status = 'contacted' THEN 10
              ELSE 0
            END +
            CASE 
              WHEN COUNT(c.id) > 0 THEN 20 ELSE 0
            END +
            CASE 
              WHEN AVG(c.duration) > 300 THEN 20
              WHEN AVG(c.duration) > 120 THEN 10
              ELSE 0
            END
          ) as "avgQualityScore"
        FROM "Leads" l
        LEFT JOIN "CallLogs" c ON l.id = c."leadId"
        WHERE l."tenantId" = :tenantId
          AND l."createdAt" BETWEEN :startDate AND :endDate
        GROUP BY l.source
        ORDER BY "avgQualityScore" DESC
      `, {
        replacements: {
          tenantId,
          startDate: start.toDate(),
          endDate: end.toDate()
        },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      return {
        summary: {
          totalLeads: leads.length,
          avgQualityScore: leads.length > 0 
            ? (leads.reduce((sum, l) => sum + parseFloat(l.qualityScore), 0) / leads.length).toFixed(2)
            : 0,
          distribution
        },
        bySource: qualityBySource,
        topLeads: leads
          .sort((a, b) => b.qualityScore - a.qualityScore)
          .slice(0, 10),
        parameters: {
          startDate: start.format('YYYY-MM-DD'),
          endDate: end.format('YYYY-MM-DD'),
          minScore,
          maxScore
        }
      };
    } catch (error) {
      console.error('Error getting lead quality report:', error);
      throw error;
    }
  }

  /**
   * Helper: Get metric time series data
   */
  async getMetricTimeSeries(model, dateField, startDate, endDate, groupBy, additionalWhere = {}) {
    try {
      let dateFormat, interval;
      
      switch (groupBy) {
        case 'hour':
          dateFormat = 'YYYY-MM-DD HH24:00:00';
          interval = '1 hour';
          break;
        case 'day':
          dateFormat = 'YYYY-MM-DD';
          interval = '1 day';
          break;
        case 'week':
          dateFormat = 'YYYY-WW';
          interval = '1 week';
          break;
        case 'month':
          dateFormat = 'YYYY-MM';
          interval = '1 month';
          break;
        default:
          dateFormat = 'YYYY-MM-DD';
          interval = '1 day';
      }
      
      // Generate time series
      const timeSeries = await this.sequelize.query(`
        SELECT 
          TO_CHAR(generate_series, '${dateFormat}') as period,
          COUNT(m.id) as count
        FROM generate_series(
          :startDate::timestamp,
          :endDate::timestamp,
          '${interval}'::interval
        ) generate_series
        LEFT JOIN "${model}s" m ON 
          TO_CHAR(m."${dateField}", '${dateFormat}') = TO_CHAR(generate_series, '${dateFormat}')
          ${Object.keys(additionalWhere).map(key => `AND m."${key}" = :${key}`).join(' ')}
        GROUP BY period
        ORDER BY period
      `, {
        replacements: {
          startDate: startDate.toDate(),
          endDate: endDate.toDate(),
          ...additionalWhere
        },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      return timeSeries.map(row => ({
        period: row.period,
        value: parseInt(row.count)
      }));
    } catch (error) {
      console.error('Error getting metric time series:', error);
      throw error;
    }
  }

  /**
   * Helper: Get journey metrics
   */
  async getJourneyMetrics(journeyId, startDate, endDate) {
    try {
      const metrics = await this.models.LeadJourney.findOne({
        where: {
          journeyId,
          startedAt: {
            [Op.between]: [startDate.toDate(), endDate.toDate()]
          }
        },
        attributes: [
          [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalEnrollments'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'active' THEN 1 ELSE 0 END`)), 'activeEnrollments'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), 'completedEnrollments'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'exited' THEN 1 ELSE 0 END`)), 'exitedEnrollments'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'failed' THEN 1 ELSE 0 END`)), 'failedEnrollments']
        ],
        raw: true
      });
      
      return {
        totalEnrollments: parseInt(metrics?.totalEnrollments || 0),
        activeEnrollments: parseInt(metrics?.activeEnrollments || 0),
        completedEnrollments: parseInt(metrics?.completedEnrollments || 0),
        exitedEnrollments: parseInt(metrics?.exitedEnrollments || 0),
        failedEnrollments: parseInt(metrics?.failedEnrollments || 0),
        completionRate: metrics?.totalEnrollments > 0
          ? (metrics.completedEnrollments / metrics.totalEnrollments * 100).toFixed(2)
          : 0
      };
    } catch (error) {
      console.error('Error getting journey metrics:', error);
      throw error;
    }
  }

  /**
   * Helper: Get journey step performance
   */
  async getJourneyStepPerformance(journeyId, startDate, endDate) {
    try {
      const stepData = await this.sequelize.query(`
        SELECT 
          js.id,
          js.name,
          js."actionType",
          js."stepOrder",
          COUNT(je.id) as executions,
          COUNT(CASE WHEN je.status = 'completed' THEN 1 END) as completions,
          COUNT(CASE WHEN je.status = 'failed' THEN 1 END) as failures,
          AVG(je."processingTime") as "avgProcessingTime"
        FROM "JourneySteps" js
        LEFT JOIN "JourneyExecutions" je ON js.id = je."stepId"
        LEFT JOIN "LeadJourneys" lj ON je."leadJourneyId" = lj.id
        WHERE js."journeyId" = :journeyId
          AND (je.id IS NULL OR lj."startedAt" BETWEEN :startDate AND :endDate)
        GROUP BY js.id, js.name, js."actionType", js."stepOrder"
        ORDER BY js."stepOrder"
      `, {
        replacements: {
          journeyId,
          startDate: startDate.toDate(),
          endDate: endDate.toDate()
        },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      return stepData.map(step => ({
        id: step.id,
        name: step.name,
        actionType: step.actionType,
        order: step.stepOrder,
        metrics: {
          executions: parseInt(step.executions),
          completions: parseInt(step.completions),
          failures: parseInt(step.failures),
          successRate: step.executions > 0
            ? (step.completions / step.executions * 100).toFixed(2)
            : 0,
          avgProcessingTime: parseFloat(step.avgProcessingTime || 0)
        }
      }));
    } catch (error) {
      console.error('Error getting journey step performance:', error);
      throw error;
    }
  }

  /**
   * Helper: Get journey conversion funnel
   */
  async getJourneyConversionFunnel(journeyId, startDate, endDate) {
    try {
      const funnelData = await this.sequelize.query(`
        WITH journey_leads AS (
          SELECT DISTINCT "leadId"
          FROM "LeadJourneys"
          WHERE "journeyId" = :journeyId
            AND "startedAt" BETWEEN :startDate AND :endDate
        )
        SELECT 
          COUNT(DISTINCT jl."leadId") as "totalLeads",
          COUNT(DISTINCT CASE WHEN l.status = 'contacted' THEN jl."leadId" END) as "contactedLeads",
          COUNT(DISTINCT CASE WHEN l.status = 'transferred' THEN jl."leadId" END) as "transferredLeads",
          COUNT(DISTINCT CASE WHEN l.status = 'completed' THEN jl."leadId" END) as "completedLeads"
        FROM journey_leads jl
        INNER JOIN "Leads" l ON jl."leadId" = l.id
      `, {
        replacements: {
          journeyId,
          startDate: startDate.toDate(),
          endDate: endDate.toDate()
        },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      const data = funnelData[0];
      return {
        stages: [
          { name: 'Enrolled', count: parseInt(data.totalLeads) },
          { name: 'Contacted', count: parseInt(data.contactedLeads) },
          { name: 'Transferred', count: parseInt(data.transferredLeads) },
          { name: 'Completed', count: parseInt(data.completedLeads) }
        ],
        conversionRate: data.totalLeads > 0
          ? (data.completedLeads / data.totalLeads * 100).toFixed(2)
          : 0
      };
    } catch (error) {
      console.error('Error getting journey conversion funnel:', error);
      throw error;
    }
  }

  /**
   * Helper: Calculate lead quality metrics
   */
  async calculateLeadQualityMetrics(tenantId, source, startDate, endDate) {
    try {
      const metrics = await this.sequelize.query(`
        SELECT 
          AVG(CASE WHEN l.email IS NOT NULL THEN 1 ELSE 0 END) * 100 as "emailRate",
          AVG(l.attempts) as "avgAttempts",
          AVG(TIMESTAMPDIFF(HOUR, l."createdAt", l."lastAttempt")) as "avgTimeToContact",
          AVG(CASE WHEN c.duration > 0 THEN c.duration ELSE NULL END) as "avgCallDuration"
        FROM "Leads" l
        LEFT JOIN "CallLogs" c ON l.id = c."leadId"
        WHERE l."tenantId" = :tenantId
          AND l.source = :source
          AND l."createdAt" BETWEEN :startDate AND :endDate
      `, {
        replacements: {
          tenantId,
          source,
          startDate: startDate.toDate(),
          endDate: endDate.toDate()
        },
        type: this.sequelize.QueryTypes.SELECT
      });
      
      return {
        emailRate: parseFloat(metrics[0].emailRate || 0).toFixed(2),
        avgAttempts: parseFloat(metrics[0].avgAttempts || 0).toFixed(2),
        avgTimeToContact: parseFloat(metrics[0].avgTimeToContact || 0).toFixed(2),
        avgCallDuration: parseFloat(metrics[0].avgCallDuration || 0).toFixed(2)
      };
    } catch (error) {
      console.error('Error calculating lead quality metrics:', error);
      return {
        emailRate: 0,
        avgAttempts: 0,
        avgTimeToContact: 0,
        avgCallDuration: 0
      };
    }
  }

  /**
   * Helper: Get lead source cost data
   */
  async getLeadSourceCostData(tenantId, source, startDate, endDate) {
    try {
      // Check if LeadGenMetrics table exists
      if (this.models.LeadGenMetrics) {
        const costData = await this.models.LeadGenMetrics.findOne({
          where: {
            tenantId,
            source,
            date: {
              [Op.between]: [startDate.toDate(), endDate.toDate()]
            }
          },
          attributes: [
            [this.sequelize.fn('SUM', this.sequelize.col('cost')), 'totalCost'],
            [this.sequelize.fn('SUM', this.sequelize.col('revenue')), 'revenue']
          ],
          raw: true
        });
        
        return {
          totalCost: parseFloat(costData?.totalCost || 0),
          revenue: parseFloat(costData?.revenue || 0)
        };
      }
      
      // Return default values if table doesn't exist
      return {
        totalCost: 0,
        revenue: 0
      };
    } catch (error) {
      console.error('Error getting lead source cost data:', error);
      return {
        totalCost: 0,
        revenue: 0
      };
    }
  }

  /**
   * Helper: Get lead gen time series
   */
  async getLeadGenTimeSeries(tenantId, startDate, endDate, sources, groupBy) {
    try {
      const whereClause = {
        tenantId,
        createdAt: {
          [Op.between]: [startDate.toDate(), endDate.toDate()]
        }
      };
      
      if (sources.length > 0) {
        whereClause.source = sources;
      }
      
     const timeSeries = await this.models.Lead.findAll({
  where: whereClause,
  attributes: [
    [this.sequelize.fn('DATE_TRUNC', this.sequelize.literal("'day'"), this.sequelize.col('createdAt')), 'date'],
    groupBy,
    [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'count']
  ],
  group: ['date', groupBy],
  order: [['date', 'ASC']],
  raw: true
});
      
      return timeSeries;
    } catch (error) {
      console.error('Error getting lead gen time series:', error);
      throw error;
    }
  }

  /**
   * Helper: Calculate percentage change
   */
  calculatePercentageChange(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous * 100).toFixed(2);
  }

  /**
   * Helper: Calculate journey summary
   */
  calculateJourneySummary(journeyData) {
    const summary = journeyData.reduce((acc, journey) => {
      acc.totalJourneys++;
      acc.totalEnrollments += journey.metrics.totalEnrollments;
      acc.activeEnrollments += journey.metrics.activeEnrollments;
      acc.completedEnrollments += journey.metrics.completedEnrollments;
      return acc;
    }, {
      totalJourneys: 0,
      totalEnrollments: 0,
      activeEnrollments: 0,
      completedEnrollments: 0
    });
    
    summary.avgCompletionRate = summary.totalEnrollments > 0
      ? (summary.completedEnrollments / summary.totalEnrollments * 100).toFixed(2)
      : 0;
    
    return summary;
  }

  /**
   * Helper: Calculate lead gen summary
   */
  calculateLeadGenSummary(sourceData) {
    const summary = sourceData.reduce((acc, source) => {
      acc.totalLeads += source.metrics.totalLeads;
      acc.totalCost += source.cost.totalCost;
      acc.totalRevenue += source.cost.revenue;
      acc.convertedLeads += source.metrics.convertedLeads;
      return acc;
    }, {
      totalLeads: 0,
      totalCost: 0,
      totalRevenue: 0,
      convertedLeads: 0
    });
    
    summary.avgCostPerLead = summary.totalLeads > 0
      ? (summary.totalCost / summary.totalLeads).toFixed(2)
      : 0;
    
    summary.overallROI = summary.totalCost > 0
      ? ((summary.totalRevenue - summary.totalCost) / summary.totalCost * 100).toFixed(2)
      : 0;
    
    summary.overallConversionRate = summary.totalLeads > 0
      ? (summary.convertedLeads / summary.totalLeads * 100).toFixed(2)
      : 0;
    
    return summary;
  }

  async getAgentStatus(tenantId) {
    try {
      // Get tenant configuration
      const tenant = await this.models.Tenant.findByPk(tenantId);
      if (!tenant || !tenant.apiConfig) {
        return {
          availableAgents: 0,
          busyAgents: 0,
          waitingCalls: 0,
          totalCalls: 0
        };
      }

      const { url: apiUrl, user, password: pass, ingroup } = tenant.apiConfig;
      
      if (!apiUrl || !ingroup) {
        return {
          availableAgents: 0,
          busyAgents: 0,
          waitingCalls: 0,
          totalCalls: 0
        };
      }

      // Extract subdomain
      let subdomain;
      try {
        subdomain = new URL(apiUrl).hostname.split('.')[0];
      } catch (err) {
        throw new Error('Invalid API URL format');
      }

      const apiParams = {
        source: subdomain,
        user,
        pass,
        stage: 'csv',
        function: 'in_group_status',
        header: 'YES',
        in_groups: ingroup
      };

      const axios = require('axios');
      const { Readable } = require('stream');
      const csv = require('csv-parser');

      const response = await axios.get(apiUrl, { params: apiParams });

      // Parse CSV response
      const results = [];
      const stream = Readable.from(response.data);
      await new Promise((resolve, reject) => {
        stream
          .pipe(csv())
          .on('data', row => results.push(row))
          .on('end', resolve)
          .on('error', reject);
      });

      // Process the results
      if (results.length > 0) {
        const row = results[0];
        return {
          availableAgents: parseInt(row.agents_waiting, 10) || 0,
          busyAgents: (parseInt(row.agents_logged_in, 10) || 0) - (parseInt(row.agents_waiting, 10) || 0),
          waitingCalls: parseInt(row.calls_waiting, 10) || 0,
          totalCalls: parseInt(row.total_calls, 10) || 0
        };
      }

      return {
        availableAgents: 0,
        busyAgents: 0,
        waitingCalls: 0,
        totalCalls: 0
      };

    } catch (error) {
      console.error(`Error getting real agent status for tenant ${tenantId}:`, error.message);
      
      // Return fallback data on error
      return {
        availableAgents: 0,
        busyAgents: 0,
        waitingCalls: 0,
        totalCalls: 0
      };
    }
  }


  /**
   * Get dashboard stats history
   */
  async getDashboardHistory(tenantId, hours = 24) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    try {
      const cutoff = moment().subtract(hours, 'hours');
      
      const snapshots = await this.models.DashboardSnapshot.findAll({
        where: {
          tenantId,
          timestamp: { [Op.gte]: cutoff.toDate() }
        },
        order: [['timestamp', 'ASC']]
      });
      
      return snapshots.map(s => ({
        timestamp: s.timestamp,
        ...s.stats
      }));
    } catch (error) {
      console.error('Error getting dashboard history:', error);
      throw error;
    }
  }

  /**
   * Aggregate statistics for faster reporting
   */
  async aggregateStatistics(date = null) {
    try {
      const targetDate = date ? moment(date) : moment().subtract(1, 'day');
      const dateStr = targetDate.format('YYYY-MM-DD');
      
      console.log(`Aggregating statistics for ${dateStr}`);
      
      // Get all tenants
      const tenants = await this.models.Tenant.findAll({
        attributes: ['id']
      });
      
      for (const tenant of tenants) {
        const tenantId = tenant.id.toString();
        
        // Aggregate call statistics
        await this.aggregateCallStats(tenantId, targetDate);
        
        // Aggregate SMS statistics
        await this.aggregateSmsStats(tenantId, targetDate);
        
        // Aggregate lead metrics
        await this.aggregateLeadMetrics(tenantId, targetDate);
        
        // Aggregate journey analytics
        await this.aggregateJourneyAnalytics(tenantId, targetDate);
      }
      
      console.log('Statistics aggregation completed');
    } catch (error) {
      console.error('Error aggregating statistics:', error);
      throw error;
    }
  }

/**
   * Helper: Aggregate call statistics
   */
  async aggregateCallStats(tenantId, date) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    const dateStr = date.format('YYYY-MM-DD');
    const startOfDay = date.clone().startOf('day');
    const endOfDay = date.clone().endOf('day');
    
    // Daily aggregation
    const dailyStats = await this.models.CallLog.findOne({
      where: {
        tenantId,
        startTime: {
          [Op.between]: [startOfDay.toDate(), endOfDay.toDate()]
        }
      },
      attributes: [
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalCalls'],
        [this.sequelize.fn('COUNT', this.sequelize.fn('DISTINCT', this.sequelize.col('leadId'))), 'uniqueLeads'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'answered' THEN 1 ELSE 0 END`)), 'answeredCalls'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'failed' THEN 1 ELSE 0 END`)), 'failedCalls'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredCalls'],
        [this.sequelize.fn('SUM', this.sequelize.col('duration')), 'totalDuration'],
        [this.sequelize.fn('AVG', this.sequelize.col('duration')), 'avgDuration']
      ],
      raw: true
    });
    
    if (dailyStats.totalCalls > 0) {
      await this.models.CallStatistics.upsert({
        tenantId,
        date: dateStr,
        hour: null,
        ...dailyStats
      });
    }
    
    // Hourly aggregation
    for (let hour = 0; hour < 24; hour++) {
      const hourStart = date.clone().hour(hour).minute(0).second(0);
      const hourEnd = hourStart.clone().add(1, 'hour');
      
      const hourlyStats = await this.models.CallLog.findOne({
        where: {
          tenantId,
          startTime: {
            [Op.between]: [hourStart.toDate(), hourEnd.toDate()]
          }
        },
        attributes: [
          [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalCalls'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'answered' THEN 1 ELSE 0 END`)), 'answeredCalls'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'failed' THEN 1 ELSE 0 END`)), 'failedCalls'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredCalls'],
          [this.sequelize.fn('SUM', this.sequelize.col('duration')), 'totalDuration'],
          [this.sequelize.fn('AVG', this.sequelize.col('duration')), 'avgDuration']
        ],
        raw: true
      });
      
      if (hourlyStats.totalCalls > 0) {
        await this.models.CallStatistics.upsert({
          tenantId,
          date: dateStr,
          hour,
          ...hourlyStats
        });
      }
    }
  }

  /**
   * Helper: Aggregate SMS statistics
   */
  async aggregateSmsStats(tenantId, date) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    const dateStr = date.format('YYYY-MM-DD');
    const startOfDay = date.clone().startOf('day');
    const endOfDay = date.clone().endOf('day');
    
    // Daily aggregation
    const dailyStats = await this.models.SmsMessage.findOne({
      where: {
        tenantId,
        createdAt: {
          [Op.between]: [startOfDay.toDate(), endOfDay.toDate()]
        }
      },
      attributes: [
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END`)), 'totalSent'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'delivered' THEN 1 ELSE 0 END`)), 'totalDelivered'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'failed' THEN 1 ELSE 0 END`)), 'totalFailed'],
        [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END`)), 'totalInbound'],
        [this.sequelize.fn('SUM', this.sequelize.col('price')), 'totalCost']
      ],
      raw: true
    });
    
    if ((dailyStats.totalSent + dailyStats.totalInbound) > 0) {
      await this.models.SmsStatistics.upsert({
        tenantId,
        date: dateStr,
        hour: null,
        ...dailyStats
      });
    }
  }

  /**
   * Helper: Aggregate lead metrics
   */
  async aggregateLeadMetrics(tenantId, date) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    const dateStr = date.format('YYYY-MM-DD');
    const startOfDay = date.clone().startOf('day');
    const endOfDay = date.clone().endOf('day');
    
    // Get unique sources and brands
    const sources = await this.models.Lead.findAll({
      where: {
        tenantId,
        createdAt: {
          [Op.between]: [startOfDay.toDate(), endOfDay.toDate()]
        }
      },
      attributes: [[this.sequelize.fn('DISTINCT', this.sequelize.col('source')), 'source']],
      raw: true
    });
    
    // Aggregate by source
    for (const { source } of sources) {
      const sourceStats = await this.models.Lead.findOne({
        where: {
          tenantId,
          source,
          createdAt: {
            [Op.between]: [startOfDay.toDate(), endOfDay.toDate()]
          }
        },
        attributes: [
          [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'totalLeads'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'contacted' THEN 1 ELSE 0 END`)), 'contactedLeads'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'transferred' THEN 1 ELSE 0 END`)), 'transferredLeads'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'completed' THEN 1 ELSE 0 END`)), 'convertedLeads'],
          [this.sequelize.fn('AVG', this.sequelize.col('attempts')), 'avgContactAttempts']
        ],
        raw: true
      });
      
      if (sourceStats.totalLeads > 0) {
        await this.models.LeadMetrics.upsert({
          tenantId,
          date: dateStr,
          source,
          brand: null,
          ...sourceStats
        });
      }
    }
  }

  /**
   * Helper: Aggregate journey analytics
   */
  async aggregateJourneyAnalytics(tenantId, date) {
    // Ensure tenantId is a string
    tenantId = this.ensureTenantIdString(tenantId);
    
    const dateStr = date.format('YYYY-MM-DD');
    const startOfDay = date.clone().startOf('day');
    const endOfDay = date.clone().endOf('day');
    
    // Get all journeys for tenant
    const journeys = await this.models.Journey.findAll({
      where: { tenantId },
      attributes: ['id']
    });
    
    for (const journey of journeys) {
      // Get enrollment stats
      const enrollmentStats = await this.models.LeadJourney.findOne({
        where: {
          journeyId: journey.id,
          [Op.or]: [
            {
              startedAt: {
                [Op.between]: [startOfDay.toDate(), endOfDay.toDate()]
              }
            },
            {
              status: 'active'
            }
          ]
        },
        attributes: [
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN DATE("startedAt") = '${dateStr}' THEN 1 ELSE 0 END`)), 'totalEnrollments'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'active' THEN 1 ELSE 0 END`)), 'activeEnrollments'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'completed' AND DATE("completedAt") = '${dateStr}' THEN 1 ELSE 0 END`)), 'completedEnrollments'],
          [this.sequelize.fn('SUM', this.sequelize.literal(`CASE WHEN status = 'exited' AND DATE("completedAt") = '${dateStr}' THEN 1 ELSE 0 END`)), 'exitedEnrollments']
        ],
        raw: true
      });
      
      if (enrollmentStats.totalEnrollments > 0 || enrollmentStats.activeEnrollments > 0) {
        await this.models.JourneyAnalytics.upsert({
          tenantId,
          journeyId: journey.id,
          date: dateStr,
          ...enrollmentStats
        });
      }
    }
  }


  /**
   * Helper: Check if query is safe
   */
  isQuerySafe(query) {
    // Basic SQL injection prevention
    const dangerousKeywords = [
      'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE'
    ];
    
    const upperQuery = query.toUpperCase();
    for (const keyword of dangerousKeywords) {
      if (upperQuery.includes(keyword)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Helper: Send report email
   */
  async sendReportEmail(report, filepath) {
    // Implement email sending logic
    console.log(`Sending report ${report.name} to recipients:`, report.schedule.recipients);
  }
}

module.exports = ReportingService;