// journey-service.js
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const axios = require('axios');

class JourneyService {
  constructor(models, tenantService) {
    this.models = models;
    this.tenantService = tenantService;
    this.timezone = 'America/Los_Angeles'; // Default, can be overridden per tenant
  }

  /**
   * Process all pending journey executions that are due
   */
  async processScheduledExecutions() {
    try {
      console.log('Processing scheduled journey executions...');
      
      // Find executions that are due
      const dueExecutions = await this.models.JourneyExecution.findAll({
        where: {
          status: 'pending',
          scheduledTime: {
            [Op.lte]: new Date()
          }
        },
        include: [
          {
            model: this.models.LeadJourney,
            as: 'leadJourney',
            include: [
              { model: this.models.Journey, as: 'journey' },
              { model: this.models.JourneyStep, as: 'currentStep' }
            ]
          },
          { model: this.models.JourneyStep, as: 'step' }
        ],
        limit: 50 // Process in batches to avoid overwhelming the system
      });
      
      console.log(`Found ${dueExecutions.length} executions to process`);
      
      for (const execution of dueExecutions) {
        try {
          // Mark as processing
          await execution.update({
            status: 'processing',
            attempts: execution.attempts + 1,
            lastAttempt: new Date()
          });
          
          // Get related data
          const leadJourney = execution.leadJourney;
          const journey = leadJourney.journey;
          const step = execution.step;
          
          // Load the lead
          const lead = await this.models.Lead.findByPk(leadJourney.leadId);
          if (!lead) {
            throw new Error(`Lead not found: ${leadJourney.leadId}`);
          }
          
          // Get the tenant
          const tenant = await this.models.Tenant.findByPk(journey.tenantId);
          if (!tenant) {
            throw new Error(`Tenant not found: ${journey.tenantId}`);
          }


          
          // Check if we're in business hours (if needed)
          const shouldRespectBusinessHours = step.actionType === 'call' || 
              (step.actionConfig && step.actionConfig.respectBusinessHours);
          
          if (shouldRespectBusinessHours && !this.isWithinBusinessHours(tenant.schedule)) {
            // Reschedule for next business hours
            const nextBusinessTime = this.getNextBusinessTime(tenant.schedule);
            await execution.update({
              status: 'pending',
              scheduledTime: nextBusinessTime
            });
            console.log(`Rescheduled execution ${execution.id} to next business hours: ${nextBusinessTime}`);
            continue;
          }
          
          // Check conditions
          if (!await this.checkConditions(step.conditions, lead, leadJourney)) {
            console.log(`Conditions not met for execution ${execution.id}, journey step ${step.id}`);
            // Mark as completed but log that conditions weren't met
            await execution.update({
              status: 'completed',
              result: { conditionsMet: false }
            });
            
            // Skip to next step if possible
            await this.advanceToNextStep(leadJourney, step, { conditionsMet: false });
            continue;
          }
          
          // Execute the action
          const result = await this.executeAction(step, lead, tenant, leadJourney);
          
          // Update execution status
          await execution.update({
            status: 'completed',
            result
          });
          
          // Update journey history
          const history = leadJourney.executionHistory || [];
          history.push({
            stepId: step.id,
            timestamp: new Date(),
            action: step.actionType,
            result,
            data: {
              actionConfig: step.actionConfig,
              executionId: execution.id
            }
          });
          
          await leadJourney.update({
            lastExecutionTime: new Date(),
            executionHistory: history
          });
          
          // Advance to next step
          await this.advanceToNextStep(leadJourney, step, result);
          
        } catch (error) {
          console.error(`Error processing execution ${execution.id}:`, error);
          
          // Update execution with error
          await execution.update({
            status: execution.attempts >= 3 ? 'failed' : 'pending',
            errorMessage: error.message,
            scheduledTime: execution.attempts >= 3 ? execution.scheduledTime : 
              new Date(Date.now() + 15 * 60 * 1000) // Retry in 15 minutes if attempts < 3
          });
        }
      }
      
      return dueExecutions.length;
    } catch (error) {
      console.error('Error in journey execution processor:', error);
      throw error;
    }
  }

  /**
   * Check if agents are available in the specified ingroup
   */
  /**
 * Check if agents are available in the specified ingroup
 */
async checkAgentAvailability(apiConfig, ingroup) {
  try {
    if (!apiConfig || !apiConfig.url) {
      console.log('No API config found for agent status check');
      return true; // Default to allow if no config
    }

    const apiParams = {
      source: apiConfig.source,
      user: apiConfig.user,
      pass: apiConfig.password || apiConfig.pass,
      stage: 'csv',
      function: 'in_group_status',
      header: 'YES',
      in_groups: ingroup
    };

    const response = await axios.get(apiConfig.url, { params: apiParams });
    
    // Parse CSV response
    const csv = require('csv-parser');
    const { Readable } = require('stream');
    const results = [];
    const stream = Readable.from(response.data);
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', row => results.push(row))
        .on('end', resolve)
        .on('error', reject);
    });
    
    // Check if any agents are available
    for (const row of results) {
      const agentsWaiting = parseInt(row.agents_waiting, 10) || 0;
      if (agentsWaiting > 0) {
        console.log(`Found ${agentsWaiting} agents available in ingroup ${ingroup}`);
        return true;
      }
    }
    
    console.log(`No agents available in ingroup ${ingroup}`);
    return false;
  } catch (error) {
    console.error('Error checking agent availability:', error);
    return true; // Default to allow on error
  }
}

  /**
   * Check if there are active calls for a lead
   */
  async hasActiveCall(leadId) {
    const activeCall = await this.models.CallLog.findOne({
      where: {
        leadId,
        status: {
          [Op.in]: ['initiated', 'answered']
        },
        endTime: null
      },
      order: [['startTime', 'DESC']]
    });

    if (activeCall) {
      // Check if last status update was more than 1 minute ago
      const lastUpdate = activeCall.lastStatusUpdate || activeCall.updatedAt;
      const timeSinceUpdate = Date.now() - new Date(lastUpdate).getTime();
      
      if (timeSinceUpdate > 60000) { // 1 minute
        // Consider this a connected call
        await activeCall.update({
          status: 'connected',
          lastStatusUpdate: new Date()
        });
        
        // Update lead status
        const lead = await this.models.Lead.findByPk(leadId);
        if (lead) {
          await lead.update({ status: 'connected' });
        }
      }
      
      return true;
    }
    
    return false;
  }
  
  /**
   * Enroll a lead in a journey
   */
  async enrollLeadInJourney(leadId, journeyId, options = {}) {
    try {
      const journey = await this.models.Journey.findByPk(journeyId);
      if (!journey) {
        throw new Error(`Journey not found: ${journeyId}`);
      }
      
      if (!journey.isActive) {
        throw new Error(`Journey is not active: ${journeyId}`);
      }
      
      // Check if lead is already in this journey
      const existingJourney = await this.models.LeadJourney.findOne({
        where: {
          leadId,
          journeyId,
          status: {
            [Op.in]: ['active', 'paused']
          }
        }
      });
      
      if (existingJourney) {
        if (options.restart) {
          // Reset the journey if restart option is true
          await existingJourney.update({
            status: 'active',
            currentStepId: null,
            nextExecutionTime: null,
            lastExecutionTime: null,
            executionHistory: [],
            contextData: {
              dayCount: 1,
              ...(options.contextData || {})
            }
          });
          
          // Cancel any pending executions
          await this.models.JourneyExecution.update(
            { status: 'cancelled' },
            {
              where: {
                leadJourneyId: existingJourney.id,
                status: 'pending'
              }
            }
          );
          
          // Start from the first step
          return this.startJourneyFromFirstStep(existingJourney);
        } else {
          // Just return the existing journey
          return existingJourney;
        }
      }
      
      // Create a new lead journey - FIXED: Include tenantId from the journey
      const leadJourney = await this.models.LeadJourney.create({
        leadId,
        journeyId,
        tenantId: journey.tenantId,
        status: 'active',
        startedAt: new Date(),
        contextData: {
          dayCount: 1,
          ...(options.contextData || {})
        }
      });
      
      // Start from the first step
      return this.startJourneyFromFirstStep(leadJourney);
    } catch (error) {
      console.error('Error enrolling lead in journey:', error);
      throw error;
    }
  }
  
  /**
   * Start a journey from the first step
   */
  async startJourneyFromFirstStep(leadJourney) {
    try {
      // Initialize day counter if not present
      const context = leadJourney.contextData || {};
      if (context.dayCount === undefined) {
        context.dayCount = 1;
        await leadJourney.update({ contextData: context });
      }

      // Find the first step
      const firstStep = await this.models.JourneyStep.findOne({
        where: {
          journeyId: leadJourney.journeyId,
          isActive: true
        },
        order: [['stepOrder', 'ASC']]
      });
      
      if (!firstStep) {
        await leadJourney.update({
          status: 'completed',
          completedAt: new Date(),
          currentStepId: null
        });
        return leadJourney;
      }
      
      // Schedule the first step
      await this.scheduleStep(leadJourney, firstStep);
      
      return leadJourney;
    } catch (error) {
      console.error('Error starting journey from first step:', error);
      throw error;
    }
  }
  
  /**
   * Schedule a journey step for execution
   */
  async scheduleStep(leadJourney, step) {
    try {
      // Calculate when to schedule this step
      const scheduledTime = await this.calculateStepExecutionTime(step, leadJourney);
      
      // Update lead journey with current step and next execution time
      await leadJourney.update({
        currentStepId: step.id,
        nextExecutionTime: scheduledTime
      });
      
      // Create execution record
      await this.models.JourneyExecution.create({
        leadJourneyId: leadJourney.id,
        stepId: step.id,
        scheduledTime,
        status: 'pending'
      });
      
      return scheduledTime;
    } catch (error) {
      console.error('Error scheduling journey step:', error);
      throw error;
    }
  }
  
  /**
   * Calculate when a step should be executed based on its delay configuration
   */
  async calculateStepExecutionTime(step, leadJourney) {
    const now = new Date();
    const journey = await this.models.Journey.findByPk(leadJourney.journeyId);
    const tenant = await this.models.Tenant.findByPk(journey.tenantId);
    
    // Use tenant timezone if available
    const timezone = tenant.timezone || this.timezone;
    
    switch (step.delayType) {
      case 'immediate':
        return now;
        
      case 'fixed_time': {
        const timeStr = step.delayConfig.time || '09:00';
        const [hours, minutes] = timeStr.split(':').map(Number);
        
        const scheduledTime = moment.tz(timezone);
        scheduledTime.hours(hours).minutes(minutes).seconds(0).milliseconds(0);
        
        // If the time has already passed today, schedule for tomorrow
        if (scheduledTime.valueOf() < Date.now()) {
          scheduledTime.add(1, 'day');
        }
        
        return scheduledTime.toDate();
      }
      
      case 'delay_after_previous': {
        const minutes = step.delayConfig.minutes || 0;
        const hours = step.delayConfig.hours || 0;
        const days = step.delayConfig.days || 0;
        
        const lastExecution = leadJourney.lastExecutionTime || leadJourney.startedAt;
        
        return moment(lastExecution)
          .add(minutes, 'minutes')
          .add(hours, 'hours')
          .add(days, 'days')
          .toDate();
      }
      
      case 'delay_after_enrollment': {
        const minutes = step.delayConfig.minutes || 0;
        const hours = step.delayConfig.hours || 0;
        const days = step.delayConfig.days || 0;
        
        return moment(leadJourney.startedAt)
          .add(minutes, 'minutes')
          .add(hours, 'hours')
          .add(days, 'days')
          .toDate();
      }
      
      case 'specific_days': {
        const days = step.delayConfig.days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        const timeStr = step.delayConfig.time || '09:00';
        const [hours, minutes] = timeStr.split(':').map(Number);
        
        // Start from today
        let scheduledTime = moment.tz(timezone);
        scheduledTime.hours(hours).minutes(minutes).seconds(0).milliseconds(0);
        
        // If current time is past the specified time, start checking from tomorrow
        if (scheduledTime.valueOf() < Date.now()) {
          scheduledTime.add(1, 'day');
        }
        
        // Find the next day that matches one in the days array
        let daysChecked = 0;
        while (daysChecked < 7) {
          const dayName = scheduledTime.format('dddd').toLowerCase();
          if (days.includes(dayName)) {
            return scheduledTime.toDate();
          }
          scheduledTime.add(1, 'day');
          daysChecked++;
        }
        
        // If no matching day found, default to tomorrow
        return moment.tz(timezone).add(1, 'day')
          .hours(hours).minutes(minutes).seconds(0).milliseconds(0)
          .toDate();
      }
      
      default:
        return now;
    }
  }
  
  /**
   * Advance to the next step in the journey
   */
  async advanceToNextStep(leadJourney, currentStep, executionResult) {
    try {
      // Check if this is an exit point
      if (currentStep.isExitPoint) {
        await leadJourney.update({
          status: 'exited',
          completedAt: new Date(),
          currentStepId: null
        });
        return;
      }
      
      // Find the next step
      let nextStep = await this.models.JourneyStep.findOne({
        where: {
          journeyId: leadJourney.journeyId,
          stepOrder: { [Op.gt]: currentStep.stepOrder },
          isActive: true
        },
        order: [['stepOrder', 'ASC']]
      });

      if (!nextStep) {
        // No more steps. Check if we should repeat from day 1
        const journey = await this.models.Journey.findByPk(leadJourney.journeyId);
        const context = leadJourney.contextData || {};
        const repeatDays = journey.repeatDays || 0;

        if (currentStep.isDayEnd && repeatDays && context.dayCount < repeatDays) {
          // Increment day counter and restart from first step
          context.dayCount = (context.dayCount || 1) + 1;
          await leadJourney.update({ contextData: context });

          nextStep = await this.models.JourneyStep.findOne({
            where: {
              journeyId: leadJourney.journeyId,
              isActive: true
            },
            order: [['stepOrder', 'ASC']]
          });
        } else {
          // Journey completed
          await leadJourney.update({
            status: 'completed',
            completedAt: new Date(),
            currentStepId: null
          });
          return;
        }
      } else if (currentStep.isDayEnd) {
        // Completed a day but more steps exist; increment day count
        const journey = await this.models.Journey.findByPk(leadJourney.journeyId);
        const context = leadJourney.contextData || {};
        const repeatDays = journey.repeatDays || 0;
        context.dayCount = (context.dayCount || 1) + 1;
        await leadJourney.update({ contextData: context });

        if (repeatDays && context.dayCount > repeatDays) {
          // Exceeded repeat days, mark completed
          await leadJourney.update({
            status: 'completed',
            completedAt: new Date(),
            currentStepId: null
          });
          return;
        }
      }
      
      // Schedule the next step
      await this.scheduleStep(leadJourney, nextStep);
    } catch (error) {
      console.error('Error advancing to next journey step:', error);
      throw error;
    }
  }
  
  /**
   * Execute a journey step action
   */
  async executeAction(step, lead, tenant, leadJourney) {
    try {
      switch (step.actionType) {
        case 'call':
          return await this.executeCallAction(step, lead, tenant, leadJourney);
        
        case 'sms':
          return await this.executeSmsAction(step, lead, tenant, leadJourney);
        
        case 'email':
          return await this.executeEmailAction(step, lead, tenant, leadJourney);
        
        case 'status_change':
          return await this.executeStatusChangeAction(step, lead, leadJourney);
        
        case 'tag_update':
          return await this.executeTagUpdateAction(step, lead, leadJourney);
        
        case 'webhook':
          return await this.executeWebhookAction(step, lead, tenant, leadJourney);
        
        case 'delay':
          // Delay is handled by scheduling, just return success
          return { success: true, action: 'delay' };
        
        default:
          throw new Error(`Unknown action type: ${step.actionType}`);
      }
    } catch (error) {
      console.error(`Error executing action ${step.actionType}:`, error);
      throw error;
    }
  }
  
 /**
 * Execute a call action with dialplan support and transfer group integration
 */
async executeCallAction(step, lead, tenant, leadJourney) {
  try {
    const config = step.actionConfig || {};
    
    // Check if there's already an active call for this lead
    if (await this.hasActiveCall(lead.id)) {
      console.log(`Lead ${lead.id} has an active call, skipping call action`);
      return {
        success: false,
        error: 'Lead has an active call',
        skipped: true
      };
    }
    
    // Initialize variables for transfer group configuration
    let transferNumber = config.transferNumber;
    let ingroup = config.ingroup || tenant.apiConfig.ingroup;
    let apiConfig = tenant.apiConfig;
    let dialerContext = config.dialerContext || tenant.amiConfig.context;
    
    // If transferGroupId is specified, load the transfer group configuration
    if (config.transferGroupId && this.models.TransferGroup) {
      try {
        const transferGroup = await this.models.TransferGroup.findOne({
          where: {
            id: config.transferGroupId,
            tenantId: tenant.id.toString(),
            isActive: true
          },
          include: [{
            model: this.models.TransferNumber,
            as: 'numbers',
            where: { isActive: true },
            required: false
          }]
        });
        
        if (transferGroup) {
          // Use transfer group's ingroup
          if (transferGroup.ingroup) {
            ingroup = transferGroup.ingroup;
          }
          
          // Use transfer group's API config if available
          if (transferGroup.apiConfig && transferGroup.apiConfig.url) {
            apiConfig = transferGroup.apiConfig;
            console.log(`Using transfer group API config for ingroup ${ingroup}`);
          }
          
          // Use transfer group's dialer context if available
          if (transferGroup.dialerContext) {
            dialerContext = transferGroup.dialerContext;
            console.log(`Using transfer group dialer context: ${dialerContext}`);
          }
          
          // Get transfer number from the group
          if (!transferNumber && transferGroup.numbers && transferGroup.numbers.length > 0) {
            const TemplateService = require('./template-service');
            const templateService = new TemplateService(this.models);
            transferNumber = await templateService.getNextTransferNumber(
              config.transferGroupId,
              tenant.id.toString()
            );
          }
          
          console.log(`Using transfer group ${transferGroup.id}: ${transferGroup.name} for call action`);
        }
      } catch (error) {
        console.error(`Error loading transfer group ${config.transferGroupId}: ${error.message}`);
      }
    }
    
    // Check agent availability using the appropriate API config (FIXED: now uses correct apiConfig)
    if (ingroup) {
      const agentsAvailable = await this.checkAgentAvailability(apiConfig, ingroup);
      if (!agentsAvailable) {
        console.log(`No agents available in ingroup ${ingroup}, rescheduling call`);
        
        // Reschedule this execution for 5 minutes later
        const execution = await this.models.JourneyExecution.findOne({
          where: {
            leadJourneyId: leadJourney.id,
            stepId: step.id,
            status: 'processing'
          },
          order: [['createdAt', 'DESC']]
        });
        
        if (execution) {
          await execution.update({
            status: 'pending',
            scheduledTime: new Date(Date.now() + 5 * 60 * 1000),
            errorMessage: 'No agents available, rescheduled'
          });
        }
        
        return {
          success: false,
          error: 'No agents available',
          rescheduled: true
        };
      }
    }
    
    // Get transfer number based on brand/ingroup if not already set
    if (!transferNumber && this.models.TransferGroup) {
      try {
        const TemplateService = require('./template-service');
        const templateService = new TemplateService(this.models);
        
        // Try to get transfer number by brand and ingroup
        const brand = lead.brand || config.brand;
        if (brand && ingroup) {
          transferNumber = await templateService.getNextTransferNumberByBrandIngroup(
            tenant.id.toString(),
            brand,
            ingroup
          );
          console.log(`Selected transfer number ${transferNumber} for brand ${brand}, ingroup ${ingroup}`);
        }
      } catch (error) {
        console.error(`Could not select transfer number: ${error.message}`);
      }
    }
    
    // Select a DID based on tenant preferences
    let did;
    try {
      // Check if DID model exists
      if (this.models.DID) {
        const dids = await this.models.DID.findAll({
          where: {
            tenantId: tenant.id.toString(),
            isActive: true
          },
          order: [['usageCount', 'ASC'], ['lastUsed', 'ASC']]
        });
        
        if (dids.length > 0) {
          did = dids[0];
        }
      }
    } catch (error) {
      console.error(`Could not select DID: ${error.message}`);
    }
    
    if (!did) {
      did = { phoneNumber: config.fallbackDID || '8005551234' };
    }
    
    // Create call log with ingroup
    const callLog = await this.models.CallLog.create({
      tenantId: tenant.id.toString(),
      leadId: lead.id,
      from: did.phoneNumber,
      to: lead.phone,
      transferNumber: transferNumber,
      status: 'initiated',
      ingroup: ingroup,
      lastStatusUpdate: new Date()
    });
    
    // Update lead
    await lead.update({
      attempts: lead.attempts + 1,
      lastAttempt: new Date(),
      status: 'contacted'
    });
    
    // Update DID usage if it's a real DID object
    if (did.id && this.models.DID) {
      await this.models.DID.update(
        {
          usageCount: did.usageCount + 1,
          lastUsed: new Date()
        },
        {
          where: { id: did.id }
        }
      );
    }
    
    // Make the call via AMI (if available)
    try {
      const AmiClient = require('asterisk-ami-client');
      const originateAmi = new AmiClient();
      
      await originateAmi.connect(
        tenant.amiConfig.username,
        tenant.amiConfig.password,
        {
          host: tenant.amiConfig.host,
          port: parseInt(tenant.amiConfig.port, 10)
        }
      );
      
      // Build variable string with dialplan options
      let variableString = `transfer_number=${transferNumber || ''},to=${lead.phone},journey_id=${leadJourney.journeyId},journey_step_id=${step.id},tenant_id=${tenant.id.toString()},call_log_id=${callLog.id},ingroup=${ingroup}`;
      
      // Add transfer group ID if used
      if (config.transferGroupId) {
        variableString += `,transfer_group_id=${config.transferGroupId}`;
      }
      
      // Add brand for tracking
      if (lead.brand) {
        variableString += `,brand=${lead.brand}`;
      }
      
      // Add dialplan specific variables
      if (config.amd !== undefined) {
        variableString += `,amd=${config.amd ? 'yes' : 'no'}`;
      }
      
      if (config.playPosition && config.playPosition >= 1 && config.playPosition <= 9) {
        variableString += `,play_position=${config.playPosition}`;
      }
      
      if (config.skipPositionAnnouncement) {
        variableString += `,skip_position=yes`;
      }
      
      if (config.ivrFile) {
        variableString += `,ivr_file=${config.ivrFile}`;
      }
      
      // Add recording ID if specified
      if (config.recordingId && this.models.Recording) {
        try {
          const recording = await this.models.Recording.findByPk(config.recordingId);
          if (recording && recording.fileName) {
            variableString += `,recording_file=${recording.fileName}`;
            
            // Track recording usage
            const RecordingService = require('./recording-service');
            const recordingService = new RecordingService(this.models);
            await recordingService.trackUsage(recording.id, tenant.id.toString(), {
              usedIn: 'journey',
              entityType: 'journey_step',
              entityId: step.id,
              leadId: lead.id
            });
          }
        } catch (error) {
          console.error(`Could not load recording: ${error.message}`);
        }
      }
      
      if (lead.name) {
        variableString += `,lead_name=${lead.name}`;
      }
      
      if (lead.email) {
        variableString += `,lead_email=${lead.email}`;
      }
      
      // Add script ID if specified
      if (config.scriptId) {
        variableString += `,script_id=${config.scriptId}`;
      }
      
      const action = {
        Action: 'Originate',
        Channel: `PJSIP/${lead.phone}@${tenant.amiConfig.trunk}`,
        Context: dialerContext, // Use the configured dialer context
        Exten: 's',
        Priority: 1,
        CallerID: did.phoneNumber,
        Timeout: 40000,
        Async: 'true',
        Variable: variableString
      };
      
      const response = await originateAmi.action(action);
      await originateAmi.disconnect();
      
      console.log(`Journey call initiated using context: ${dialerContext}`);
      
      return {
        success: true,
        callId: callLog.id,
        didUsed: did.phoneNumber,
        transferNumber: transferNumber,
        ingroup: ingroup,
        brand: lead.brand,
        dialerContext: dialerContext,
        transferGroupId: config.transferGroupId,
        apiConfig: {
          url: apiConfig.url,
          ingroup: ingroup
        },
        dialplanOptions: {
          amd: config.amd,
          playPosition: config.playPosition,
          skipPositionAnnouncement: config.skipPositionAnnouncement,
          ivrFile: config.ivrFile,
          recordingId: config.recordingId
        },
        amiResponse: response
      };
    } catch (error) {
      console.error(`AMI error: ${error.message}`);
      
      // Log as a simulated call if AMI fails
      return {
        success: true,
        callId: callLog.id,
        didUsed: did.phoneNumber,
        transferNumber: transferNumber,
        ingroup: ingroup,
        brand: lead.brand,
        dialerContext: dialerContext,
        transferGroupId: config.transferGroupId,
        apiConfig: {
          url: apiConfig.url,
          ingroup: ingroup
        },
        simulated: true,
        error: error.message
      };
    }
  } catch (error) {
    console.error(`Error executing call action: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

  /**
   * Execute an SMS action
   */
  
  /**
   * Execute an SMS action
   */
  async executeSmsAction(step, lead, tenant, leadJourney) {
    try {
      const config = step.actionConfig || {};
      
      // Check if SMS service is available
      if (this.models.SmsMessage && this.models.Template) {
        // Determine which SMS service to use
        const provider = config.provider || tenant.smsProvider || 'twilio';
        
        if (provider === 'meera') {
          const MeeraService = require('./meera-service');
          const meeraService = new MeeraService(this.models);
          
          const result = await meeraService.sendTemplatedSms(tenant.id.toString(), {
            to: lead.phone,
            templateId: config.templateId,
            variables: {
              leadName: lead.name,
              ...config.variables
            },
            leadId: lead.id
          });
          
          return result;
        } else {
          // Use existing Twilio service
          const TwilioService = require('./twilio-service');
          const twilioService = new TwilioService(this.models);
          
          const result = await twilioService.sendTemplatedSms(tenant.id.toString(), {
            to: lead.phone,
            templateId: config.templateId,
            variables: {
              leadName: lead.name,
              ...config.variables
            },
            leadId: lead.id
          });
          
          return result;
        }
      } else {
        // Simulation fallback
        return {
          success: true,
          message: 'SMS simulation (SMS service not configured)',
          to: lead.phone,
          template: config.templateId,
          provider: config.provider || 'unknown'
        };
      }
    } catch (error) {
      console.error(`Error executing SMS action: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Execute an email action
   */
  async executeEmailAction(step, lead, tenant, leadJourney) {
    try {
      const config = step.actionConfig || {};
      
      // Check if email service is available
      if (this.models.Template) {
        const TemplateService = require('./template-service');
        const templateService = new TemplateService(this.models);
        
        const result = await templateService.sendTemplatedEmail(tenant.id.toString(), {
          to: lead.email,
          templateId: config.templateId,
          variables: {
            leadName: lead.name,
            ...config.variables
          }
        });
        
        return result;
      } else {
        // Simulation fallback
        return {
          success: true,
          message: 'Email simulation (Email service not configured)',
          to: lead.email,
          template: config.templateId
        };
      }
    } catch (error) {
      console.error(`Error executing email action: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Execute a status change action
   */
  async executeStatusChangeAction(step, lead, leadJourney) {
    try {
      const config = step.actionConfig || {};
      const newStatus = config.newStatus;
      
      if (!newStatus) {
        throw new Error('No new status specified in action config');
      }
      
      const previousStatus = lead.status;
      
      // Update lead status
      await lead.update({
        status: newStatus
      });
      
      return {
        success: true,
        previousStatus,
        newStatus
      };
    } catch (error) {
      console.error(`Error executing status change action: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Execute a tag update action
   */
  async executeTagUpdateAction(step, lead, leadJourney) {
    try {
      const config = step.actionConfig || {};
      const operation = config.operation || 'add';
      const tags = config.tags || [];
      
      // Get current lead tags
      const currentTags = lead.additionalData.tags || [];
      let newTags;
      
      switch (operation) {
        case 'add':
          newTags = [...new Set([...currentTags, ...tags])];
          break;
        
        case 'remove':
          newTags = currentTags.filter(tag => !tags.includes(tag));
          break;
        
        case 'set':
          newTags = [...tags];
          break;
        
        default:
          throw new Error(`Unknown tag operation: ${operation}`);
      }
      
      // Update lead
      const additionalData = { ...lead.additionalData, tags: newTags };
      await lead.update({ additionalData });
      
      return {
        success: true,
        operation,
        previousTags: currentTags,
        newTags
      };
    } catch (error) {
      console.error(`Error executing tag update action: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Execute a webhook action
   */
  async executeWebhookAction(step, lead, tenant, leadJourney) {
    try {
      const config = step.actionConfig || {};
      const url = config.url;
      const method = config.method || 'POST';
      const headers = config.headers || {
        'Content-Type': 'application/json'
      };
      
      if (!url) {
        throw new Error('No URL specified in webhook action config');
      }
      
      // Prepare the payload
      const payload = {
        lead: {
          id: lead.id,
          phone: lead.phone,
          name: lead.name,
          email: lead.email,
          status: lead.status,
          additionalData: lead.additionalData
        },
        journey: {
          id: leadJourney.journeyId,
          stepId: step.id,
          contextData: leadJourney.contextData
        },
        tenant: {
          id: tenant.id,
          name: tenant.name
        },
        timestamp: new Date().toISOString()
      };
      
      // Create a hash of the payload to use as an idempotency key
      const crypto = require('crypto');
      const idempotencyKey = crypto
        .createHash('md5')
        .update(JSON.stringify(payload))
        .digest('hex');
      
      headers['X-Idempotency-Key'] = idempotencyKey;
      
      // Make the HTTP request
      const axios = require('axios');
      const response = await axios({
        method,
        url,
        headers,
        data: method !== 'GET' ? payload : undefined,
        params: method === 'GET' ? payload : undefined,
        timeout: 10000 // 10 second timeout
      });
      
      return {
        success: true,
        statusCode: response.status,
        responseData: response.data
      };
    } catch (error) {
      console.error(`Error executing webhook action: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Check if a journey step's conditions are met
   */
  async checkConditions(conditions, lead, leadJourney) {
    try {
      // If no conditions specified, always proceed
      if (!conditions || Object.keys(conditions).length === 0) {
        return true;
      }
      
      // Check lead status condition
      if (conditions.status && lead.status !== conditions.status) {
        return false;
      }
      
      // Check tags condition
      if (conditions.tags && conditions.tags.length > 0) {
        const leadTags = lead.additionalData.tags || [];
        const hasAllTags = conditions.tags.every(tag => leadTags.includes(tag));
        if (!hasAllTags) {
          return false;
        }
      }
      
      // Check call outcomes from previous steps
      if (conditions.callOutcomes && conditions.callOutcomes.length > 0) {
        // Get the last call outcome from history
        const history = leadJourney.executionHistory || [];
        const callSteps = history.filter(entry => entry.action === 'call');
        
        if (callSteps.length === 0) {
          // No previous call steps, so can't match outcomes
          return false;
        }
        
        const lastCall = callSteps[callSteps.length - 1];
        const outcome = lastCall.result && lastCall.result.outcome;
        
        if (!outcome || !conditions.callOutcomes.includes(outcome)) {
          return false;
        }
      }
      
      // All conditions passed
      return true;
    } catch (error) {
      console.error('Error checking conditions:', error);
      return false;
    }
  }
  
  /**
   * Check if current time is within business hours
   */
  isWithinBusinessHours(schedule) {
    const now = moment().tz(this.timezone);
    const dayOfWeek = now.format('dddd').toLowerCase();
    
    if (!schedule[dayOfWeek] || !schedule[dayOfWeek].enabled) {
      return false;
    }
    
    const currentTime = now.format('HH:mm');
    const startTime = schedule[dayOfWeek].start;
    const endTime = schedule[dayOfWeek].end;
    
    if (currentTime < startTime || currentTime > endTime) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get the next time within business hours
   */
  getNextBusinessTime(schedule) {
    const now = moment().tz(this.timezone);
    let currentDay = now.format('dddd').toLowerCase();
    let currentDate = now.clone();
    
    // Check if the current day is a business day
    if (!schedule[currentDay] || !schedule[currentDay].enabled) {
      // Find the next business day
      for (let i = 1; i <= 7; i++) {
        currentDate = currentDate.add(1, 'day');
        currentDay = currentDate.format('dddd').toLowerCase();
        
        if (schedule[currentDay] && schedule[currentDay].enabled) {
          // Found a business day, set time to start time
          const [hours, minutes] = schedule[currentDay].start.split(':').map(Number);
          return currentDate.hours(hours).minutes(minutes).seconds(0).milliseconds(0).toDate();
        }
      }
      
      // No business days found in the next week
      return now.add(1, 'day').hours(9).minutes(0).seconds(0).milliseconds(0).toDate();
    }
    
    // Current day is a business day
    const startTime = schedule[currentDay].start;
    const endTime = schedule[currentDay].end;
    const currentTime = now.format('HH:mm');
    
    if (currentTime < startTime) {
      // Before business hours, return start time today
      const [hours, minutes] = startTime.split(':').map(Number);
      return now.hours(hours).minutes(minutes).seconds(0).milliseconds(0).toDate();
    }
    
    if (currentTime > endTime) {
      // After business hours, find the next business day
      for (let i = 1; i <= 7; i++) {
        currentDate = currentDate.add(1, 'day');
        currentDay = currentDate.format('dddd').toLowerCase();
        
        if (schedule[currentDay] && schedule[currentDay].enabled) {
          // Found a business day, set time to start time
          const [hours, minutes] = schedule[currentDay].start.split(':').map(Number);
          return currentDate.hours(hours).minutes(minutes).seconds(0).milliseconds(0).toDate();
        }
      }
      
      // No business days found in the next week
      return now.add(1, 'day').hours(9).minutes(0).seconds(0).milliseconds(0).toDate();
    }
    
    // Within business hours, return current time
    return now.toDate();
  }
}

module.exports = JourneyService;