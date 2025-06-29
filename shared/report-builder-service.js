// report-builder-service.js
// Service for custom report builder functionality

const { Op, fn, col, literal } = require('sequelize');
const moment = require('moment-timezone');
const crypto = require('crypto');

class ReportBuilderService {
  constructor(models, sequelize) {
    this.models = models;
    this.sequelize = sequelize;
  }

  /**
   * Create a new custom report
   */
  async createReport(tenantId, reportData, userId) {
    try {
      // Generate public token if report is public
      let publicToken = null;
      if (reportData.isPublic) {
        publicToken = crypto.randomBytes(32).toString('hex');
      }

      const report = await this.models.ReportBuilder.create({
        tenantId,
        ...reportData,
        publicToken,
        createdBy: userId,
        lastModifiedBy: userId
      });

      return report;
    } catch (error) {
      console.error('Error creating report:', error);
      throw error;
    }
  }

  /**
   * Update a custom report
   */
  async updateReport(reportId, reportData, tenantId, userId) {
    try {
      const report = await this.models.ReportBuilder.findOne({
        where: { id: reportId, tenantId }
      });

      if (!report) {
        throw new Error('Report not found');
      }

      // Update version if layout or data sources changed
      const layoutChanged = JSON.stringify(report.layout) !== JSON.stringify(reportData.layout);
      const dataSourcesChanged = JSON.stringify(report.dataSources) !== JSON.stringify(reportData.dataSources);
      
      if (layoutChanged || dataSourcesChanged) {
        reportData.version = (report.version || 1) + 1;
      }

      reportData.lastModifiedBy = userId;

      await report.update(reportData);
      return report;
    } catch (error) {
      console.error('Error updating report:', error);
      throw error;
    }
  }

  /**
   * Add a widget to a report
   */
  async addWidget(reportId, widgetData, tenantId) {
    try {
      const report = await this.models.ReportBuilder.findOne({
        where: { id: reportId, tenantId }
      });

      if (!report) {
        throw new Error('Report not found');
      }

      // Get the next order number
      const maxOrder = await this.models.ReportWidget.max('order', {
        where: { reportBuilderId: reportId }
      }) || 0;

      const widget = await this.models.ReportWidget.create({
        reportBuilderId: reportId,
        ...widgetData,
        order: maxOrder + 1
      });

      return widget;
    } catch (error) {
      console.error('Error adding widget:', error);
      throw error;
    }
  }

  /**
   * Update a widget
   */
  async updateWidget(widgetId, widgetData, tenantId) {
    try {
      const widget = await this.models.ReportWidget.findOne({
        where: { id: widgetId },
        include: [{
          model: this.models.ReportBuilder,
          where: { tenantId }
        }]
      });

      if (!widget) {
        throw new Error('Widget not found');
      }

      await widget.update(widgetData);
      return widget;
    } catch (error) {
      console.error('Error updating widget:', error);
      throw error;
    }
  }

  /**
   * Delete a widget
   */
  async deleteWidget(widgetId, tenantId) {
    try {
      const result = await this.models.ReportWidget.destroy({
        where: { id: widgetId },
        include: [{
          model: this.models.ReportBuilder,
          where: { tenantId }
        }]
      });

      return result > 0;
    } catch (error) {
      console.error('Error deleting widget:', error);
      throw error;
    }
  }

  /**
   * Reorder widgets
   */
  async reorderWidgets(reportId, widgetOrders, tenantId) {
    const transaction = await this.sequelize.transaction();
    
    try {
      // Verify report ownership
      const report = await this.models.ReportBuilder.findOne({
        where: { id: reportId, tenantId },
        transaction
      });

      if (!report) {
        throw new Error('Report not found');
      }

      // Update widget orders
      for (const { widgetId, order } of widgetOrders) {
        await this.models.ReportWidget.update(
          { order },
          {
            where: { id: widgetId, reportBuilderId: reportId },
            transaction
          }
        );
      }

      await transaction.commit();
      return true;
    } catch (error) {
      await transaction.rollback();
      console.error('Error reordering widgets:', error);
      throw error;
    }
  }

  /**
   * Execute a widget query
   */
  async executeWidgetQuery(widget, parameters = {}) {
    try {
      const { dataSource, type } = widget;
      
      // Get the report's data sources
      const report = await this.models.ReportBuilder.findByPk(widget.reportBuilderId);
      if (!report) {
        throw new Error('Report not found');
      }

      const sourceConfig = report.dataSources.find(ds => ds.id === dataSource.sourceId);
      if (!sourceConfig) {
        throw new Error('Data source not found');
      }

      let data;
      
      switch (sourceConfig.type) {
        case 'table':
          data = await this.executeTableQuery(sourceConfig, dataSource, parameters);
          break;
        case 'query':
          data = await this.executeCustomQuery(sourceConfig, parameters);
          break;
        case 'api':
          data = await this.executeApiQuery(sourceConfig, parameters);
          break;
        default:
          throw new Error(`Unsupported data source type: ${sourceConfig.type}`);
      }

      // Process data based on widget type
      return this.processWidgetData(widget, data);
    } catch (error) {
      console.error('Error executing widget query:', error);
      throw error;
    }
  }

  /**
   * Execute a table-based query
   */
  async executeTableQuery(sourceConfig, dataSource, parameters) {
    try {
      const { table, fields, filters, joins } = sourceConfig;
      const { aggregation, groupBy, orderBy, limit } = dataSource;

      // Build query
      let query = `SELECT `;
      
      // Handle aggregations
      if (aggregation) {
        query += this.buildAggregationQuery(fields, aggregation, groupBy);
      } else {
        query += fields.join(', ');
      }
      
      query += ` FROM "${table}"`;
      
      // Add joins
      if (joins && joins.length > 0) {
        for (const join of joins) {
          query += ` ${join.type} JOIN "${join.table}" ON ${join.condition}`;
        }
      }
      
      // Add filters
      const whereConditions = this.buildWhereConditions(filters, parameters);
      if (whereConditions) {
        query += ` WHERE ${whereConditions}`;
      }
      
      // Add group by
      if (groupBy && groupBy.length > 0) {
        query += ` GROUP BY ${groupBy.join(', ')}`;
      }
      
      // Add order by
      if (orderBy && orderBy.length > 0) {
        const orderClauses = orderBy.map(o => `${o.field} ${o.direction || 'ASC'}`);
        query += ` ORDER BY ${orderClauses.join(', ')}`;
      }
      
      // Add limit
      if (limit) {
        query += ` LIMIT ${limit}`;
      }

      const results = await this.sequelize.query(query, {
        type: this.sequelize.QueryTypes.SELECT,
        replacements: parameters
      });

      return results;
    } catch (error) {
      console.error('Error executing table query:', error);
      throw error;
    }
  }

  /**
   * Build aggregation query
   */
  buildAggregationQuery(fields, aggregation, groupBy) {
    const selectClauses = [];
    
    // Add group by fields
    if (groupBy && groupBy.length > 0) {
      selectClauses.push(...groupBy);
    }
    
    // Add aggregation
    switch (aggregation.type) {
      case 'count':
        selectClauses.push(`COUNT(${aggregation.field || '*'}) as value`);
        break;
      case 'sum':
        selectClauses.push(`SUM(${aggregation.field}) as value`);
        break;
      case 'avg':
        selectClauses.push(`AVG(${aggregation.field}) as value`);
        break;
      case 'min':
        selectClauses.push(`MIN(${aggregation.field}) as value`);
        break;
      case 'max':
        selectClauses.push(`MAX(${aggregation.field}) as value`);
        break;
      case 'count_distinct':
        selectClauses.push(`COUNT(DISTINCT ${aggregation.field}) as value`);
        break;
    }
    
    return selectClauses.join(', ');
  }

  /**
   * Build WHERE conditions
   */
  buildWhereConditions(filters, parameters) {
    if (!filters || Object.keys(filters).length === 0) {
      return null;
    }
    
    const conditions = [];
    
    for (const [field, filter] of Object.entries(filters)) {
      if (filter.operator === 'between' && filter.value && filter.value.length === 2) {
        conditions.push(`${field} BETWEEN :${field}_start AND :${field}_end`);
        parameters[`${field}_start`] = filter.value[0];
        parameters[`${field}_end`] = filter.value[1];
      } else if (filter.operator === 'in' && Array.isArray(filter.value)) {
        conditions.push(`${field} IN (:${field})`);
        parameters[field] = filter.value;
      } else if (filter.operator === 'like') {
        conditions.push(`${field} LIKE :${field}`);
        parameters[field] = `%${filter.value}%`;
      } else {
        conditions.push(`${field} ${filter.operator} :${field}`);
        parameters[field] = filter.value;
      }
    }
    
    return conditions.join(' AND ');
  }

  /**
   * Process widget data based on widget type
   */
  async processWidgetData(widget, rawData) {
    const { type, config } = widget;
    
    switch (type) {
      case 'metric':
        return this.processMetricData(rawData, config);
      case 'chart':
        return this.processChartData(rawData, config);
      case 'table':
        return this.processTableData(rawData, config);
      case 'gauge':
        return this.processGaugeData(rawData, config);
      case 'timeline':
        return this.processTimelineData(rawData, config);
      default:
        return rawData;
    }
  }

  /**
   * Process data for metric widget
   */
  processMetricData(data, config) {
    if (!data || data.length === 0) {
      return { value: 0, formatted: '0' };
    }
    
    const value = data[0].value || 0;
    let formatted = value.toString();
    
    // Apply formatting
    if (config.format === 'currency') {
      formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: config.currency || 'USD'
      }).format(value);
    } else if (config.format === 'percentage') {
      formatted = `${(value * 100).toFixed(2)}%`;
    } else if (config.format === 'number') {
      formatted = new Intl.NumberFormat('en-US').format(value);
    }
    
    // Add prefix/suffix
    if (config.prefix) {
      formatted = config.prefix + formatted;
    }
    if (config.suffix) {
      formatted = formatted + config.suffix;
    }
    
    return { value, formatted };
  }

  /**
   * Process data for chart widget
   */
  processChartData(data, config) {
    const { type: chartType, xAxis, yAxis, series } = config;
    
    if (chartType === 'pie' || chartType === 'donut') {
      return {
        labels: data.map(row => row[xAxis]),
        datasets: [{
          data: data.map(row => row[yAxis])
        }]
      };
    }
    
    // For line, bar, area charts
    const labels = [...new Set(data.map(row => row[xAxis]))];
    const datasets = [];
    
    if (series && series.length > 0) {
      // Multiple series
      for (const seriesConfig of series) {
        const seriesData = labels.map(label => {
          const row = data.find(r => r[xAxis] === label && r[seriesConfig.field] === seriesConfig.value);
          return row ? row[yAxis] : 0;
        });
        
        datasets.push({
          label: seriesConfig.label,
          data: seriesData
        });
      }
    } else {
      // Single series
      datasets.push({
        label: yAxis,
        data: labels.map(label => {
          const row = data.find(r => r[xAxis] === label);
          return row ? row[yAxis] : 0;
        })
      });
    }
    
    return { labels, datasets };
  }

  /**
   * Get available data sources for a tenant
   */
  async getAvailableDataSources(tenantId) {
    try {
      // Get custom data sources
      const customSources = await this.models.ReportDataSource.findAll({
        where: { tenantId, isActive: true }
      });
      
      // Add default table sources
      const defaultSources = [
        {
          id: 'leads',
          name: 'Leads',
          type: 'table',
          config: { tableName: 'Leads' },
          schema: {
            id: { type: 'number', label: 'ID' },
            name: { type: 'string', label: 'Name' },
            phone: { type: 'string', label: 'Phone' },
            email: { type: 'string', label: 'Email' },
            status: { type: 'string', label: 'Status' },
            createdAt: { type: 'date', label: 'Created Date' }
          }
        },
        {
          id: 'calls',
          name: 'Call Logs',
          type: 'table',
          config: { tableName: 'CallLogs' },
          schema: {
            id: { type: 'number', label: 'ID' },
            leadId: { type: 'number', label: 'Lead ID' },
            from: { type: 'string', label: 'From Number' },
            to: { type: 'string', label: 'To Number' },
            duration: { type: 'number', label: 'Duration' },
            status: { type: 'string', label: 'Status' },
            startTime: { type: 'date', label: 'Start Time' }
          }
        },
        {
          id: 'journeys',
          name: 'Journey Analytics',
          type: 'table',
          config: { tableName: 'JourneyAnalytics' },
          schema: {
            journeyId: { type: 'number', label: 'Journey ID' },
            date: { type: 'date', label: 'Date' },
            totalEnrollments: { type: 'number', label: 'Total Enrollments' },
            activeEnrollments: { type: 'number', label: 'Active Enrollments' },
            completedEnrollments: { type: 'number', label: 'Completed' },
            conversionRate: { type: 'number', label: 'Conversion Rate' }
          }
        }
      ];
      
      return [...defaultSources, ...customSources];
    } catch (error) {
      console.error('Error getting available data sources:', error);
      throw error;
    }
  }

  /**
   * Validate report configuration
   */
  async validateReportConfig(reportConfig) {
    const errors = [];
    
    // Validate data sources
    if (!reportConfig.dataSources || reportConfig.dataSources.length === 0) {
      errors.push('At least one data source is required');
    }
    
    // Validate layout
    if (!reportConfig.layout || !reportConfig.layout.type) {
      errors.push('Layout configuration is required');
    }
    
    // Validate widgets if present
    if (reportConfig.widgets) {
      for (const widget of reportConfig.widgets) {
        if (!widget.type) {
          errors.push('Widget type is required');
        }
        if (!widget.dataSource || !widget.dataSource.sourceId) {
          errors.push('Widget data source is required');
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Clone a report
   */
  async cloneReport(reportId, tenantId, userId, newName) {
    const transaction = await this.sequelize.transaction();
    
    try {
      // Get original report
      const originalReport = await this.models.ReportBuilder.findOne({
        where: { id: reportId, tenantId },
        include: [{
          model: this.models.ReportWidget,
          as: 'widgets'
        }],
        transaction
      });
      
      if (!originalReport) {
        throw new Error('Report not found');
      }
      
      // Create new report
      const reportData = originalReport.toJSON();
      delete reportData.id;
      delete reportData.createdAt;
      delete reportData.updatedAt;
      reportData.name = newName || `${reportData.name} (Copy)`;
      reportData.createdBy = userId;
      reportData.lastModifiedBy = userId;
      reportData.version = 1;
      
      if (reportData.isPublic) {
        reportData.publicToken = crypto.randomBytes(32).toString('hex');
      }
      
      const newReport = await this.models.ReportBuilder.create(reportData, { transaction });
      
      // Clone widgets
      if (originalReport.widgets && originalReport.widgets.length > 0) {
        const widgetPromises = originalReport.widgets.map(async (widget) => {
          const widgetData = widget.toJSON();
          delete widgetData.id;
          delete widgetData.createdAt;
          delete widgetData.updatedAt;
          widgetData.reportBuilderId = newReport.id;
          
          return this.models.ReportWidget.create(widgetData, { transaction });
        });
        
        await Promise.all(widgetPromises);
      }
      
      await transaction.commit();
      return newReport;
    } catch (error) {
      await transaction.rollback();
      console.error('Error cloning report:', error);
      throw error;
    }
  }

  /**
   * Get report by public token
   */
  async getReportByToken(publicToken) {
    try {
      const report = await this.models.ReportBuilder.findOne({
        where: { publicToken, isPublic: true },
        include: [{
          model: this.models.ReportWidget,
          as: 'widgets',
          where: { isVisible: true },
          required: false,
          order: [['order', 'ASC']]
        }]
      });
      
      if (!report) {
        throw new Error('Report not found or not public');
      }
      
      return report;
    } catch (error) {
      console.error('Error getting report by token:', error);
      throw error;
    }
  }
}

module.exports = ReportBuilderService;