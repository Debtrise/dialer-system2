// journey-logger.js
const winston = require('winston');
const { format } = winston;
const { Pool } = require('pg');

// Create PostgreSQL transport for Winston
class PostgresTransport extends winston.Transport {
  constructor(options) {
    super(options);
    this.name = 'postgres';
    this.level = options.level || 'info';
    
    this.pool = new Pool({
      connectionString: options.connectionString
    });
    
    this.tableName = options.tableName || 'event_logs';
    this.batchSize = options.batchSize || 10;
    this.batchInterval = options.batchInterval || 5000;
    
    this.logQueue = [];
    this.timer = setInterval(() => this.flush(), this.batchInterval);
  }
  
  async log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });
    
    try {
      // Add to queue
      this.logQueue.push(info);
      
      // Flush if batch size is reached
      if (this.logQueue.length >= this.batchSize) {
        this.flush();
      }
      
      callback();
    } catch (err) {
      console.error('Error queuing log:', err);
      callback(err);
    }
  }
  
  async flush() {
    if (this.logQueue.length === 0) return;
    
    const logs = [...this.logQueue];
    this.logQueue = [];
    
    try {
      const client = await this.pool.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const log of logs) {
          const { 
            tenant_id, category, event_type, severity, 
            description, entities, user_id, data, metadata 
          } = log;
          
          await client.query(
            `INSERT INTO ${this.tableName} 
            (tenant_id, category, event_type, severity, description, entities, user_id, data, metadata) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              tenant_id, 
              category, 
              event_type, 
              severity, 
              description,
              JSON.stringify(entities || {}),
              user_id,
              JSON.stringify(data || {}),
              JSON.stringify(metadata || {})
            ]
          );
        }
        
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error flushing logs to database:', err);
      // Put logs back in queue for retry
      this.logQueue = [...logs, ...this.logQueue];
    }
  }
}

// Create JourneyLogger class
class JourneyLogger {
  constructor(config) {
    this.tenantId = config.tenantId;
    
    // Create Winston logger
    this.logger = winston.createLogger({
      level: config.logLevel || 'info',
      format: format.combine(
        format.timestamp(),
        format.json()
      ),
      defaultMeta: { tenant_id: this.tenantId },
      transports: [
        // Console transport
        new winston.transports.Console({
          format: format.combine(
            format.colorize(),
            format.simple()
          )
        }),
        
        // PostgreSQL transport
        new PostgresTransport({
          level: 'info',
          connectionString: config.dbUrl,
          tableName: 'event_logs',
          batchSize: 10,
          batchInterval: 5000
        })
      ]
    });
  }
  
  // Log journey event
  logJourneyEvent(eventType, journeyId, data = {}, options = {}) {
    this.logger.info({
      category: 'journey',
      event_type: eventType,
      severity: options.severity || 'INFO',
      description: options.description || `Journey ${eventType}`,
      entities: { journeyId, ...options.entities },
      user_id: options.userId,
      data,
      metadata: options.metadata || {}
    });
  }
  
  // Log step execution
  logStepExecution(stepId, journeyId, leadId, executionId, actionType, result, options = {}) {
    this.logger.info({
      category: 'journey.execution',
      event_type: 'step.executed',
      severity: result.success ? 'INFO' : 'ERROR',
      description: options.description || `Step executed: ${actionType}`,
      entities: { 
        stepId, 
        journeyId, 
        leadId, 
        executionId,
        ...options.entities 
      },
      user_id: options.userId,
      data: {
        actionType,
        result
      },
      metadata: options.metadata || {}
    });
  }
  
  // Log lead journey event
  logLeadJourneyEvent(eventType, leadId, journeyId, data = {}, options = {}) {
    this.logger.info({
      category: 'lead.journey',
      event_type: eventType,
      severity: options.severity || 'INFO',
      description: options.description || `Lead journey ${eventType}`,
      entities: { 
        leadId, 
        journeyId,
        ...options.entities 
      },
      user_id: options.userId,
      data,
      metadata: options.metadata || {}
    });
  }
  
  // Log communication event
  logCommunicationEvent(type, leadId, journeyId, stepId, result, options = {}) {
    this.logger.info({
      category: 'communication',
      event_type: type,
      severity: result.success ? 'INFO' : 'ERROR',
      description: options.description || `${type} communication`,
      entities: { 
        leadId, 
        journeyId,
        stepId,
        ...options.entities 
      },
      user_id: options.userId,
      data: result,
      metadata: options.metadata || {}
    });
  }
  
  // Log error
  logError(category, message, error, contextData = {}) {
    this.logger.error({
      category,
      event_type: 'error',
      severity: 'ERROR',
      description: message,
      entities: contextData.entities || {},
      user_id: contextData.userId,
      data: {
        error: error.message,
        stack: error.stack,
        ...contextData.data
      },
      metadata: contextData.metadata || {}
    });
  }
}

module.exports = JourneyLogger;
