// dialplan-builder/services/deploymentService.js

const fs = require('fs').promises;
const path = require('path');
const ssh2 = require('ssh2');
const { Client } = ssh2;

/**
 * Service for deploying dialplans to Asterisk servers
 * @param {Object} models - Database models
 * @returns {Object} Deployment service methods
 */
module.exports = (models) => {
  const { DialPlanProject, DeploymentHistory } = models;
  const generatorService = require('./generatorService')(models);
  const validationService = require('./validationService')(models);
  
  /**
   * Deploy a dialplan to an Asterisk server
   * @param {number} projectId - Project ID
   * @param {string} tenantId - Tenant ID
   * @param {Object} deploymentOptions - Deployment options
   * @param {string} deploymentOptions.server - Server address
   * @param {number} deploymentOptions.port - SSH port
   * @param {string} deploymentOptions.username - SSH username
   * @param {string} deploymentOptions.password - SSH password
   * @param {string} deploymentOptions.privateKey - SSH private key (alternative to password)
   * @param {string} deploymentOptions.asteriskPath - Path to Asterisk configuration
   * @param {boolean} deploymentOptions.testOnly - Test connection only, don't deploy
   * @param {number} userId - ID of the user initiating the deployment
   * @returns {Object} Deployment results
   */
  const deployDialplan = async (projectId, tenantId, deploymentOptions, userId) => {
    try {
      // Validate the project first
      const validationResult = await validationService.validateProject(projectId, tenantId);
      
      if (!validationResult.valid) {
        return {
          success: false,
          message: 'Project validation failed',
          validationResult
        };
      }
      
      // Generate the dialplan
      const { dialplan, project: projectName } = await generatorService.generateDialplan(projectId, tenantId);
      
      // Check if this is a test only
      if (deploymentOptions.testOnly) {
        return {
          success: true,
          message: 'Validation successful, deployment test passed',
          dialplan,
          validationResult
        };
      }
      
      // Deploy to the Asterisk server
      const deploymentResult = await deployToAsterisk(dialplan, deploymentOptions);
      
      // Record the deployment in the database
      const deployment = await DeploymentHistory.create({
        projectId,
        tenantId,
        userId,
        deployedAt: new Date(),
        status: deploymentResult.success ? 'success' : 'failed',
        serverResponse: deploymentResult.message,
        configSnapshot: {
          dialplan,
          options: {
            server: deploymentOptions.server,
            port: deploymentOptions.port,
            username: deploymentOptions.username,
            asteriskPath: deploymentOptions.asteriskPath
          }
        }
      });
      
      // Update the project's lastDeployed timestamp if successful
      if (deploymentResult.success) {
        await DialPlanProject.update(
          { lastDeployed: new Date() },
          { where: { id: projectId, tenantId } }
        );
      }
      
      return {
        success: deploymentResult.success,
        message: deploymentResult.message,
        deploymentId: deployment.id,
        timestamp: deployment.deployedAt,
        validationResult
      };
    } catch (error) {
      console.error('Error deploying dialplan:', error);
      
      // Record failed deployment
      if (!deploymentOptions.testOnly) {
        try {
          await DeploymentHistory.create({
            projectId,
            tenantId,
            userId,
            deployedAt: new Date(),
            status: 'failed',
            serverResponse: error.message
          });
        } catch (dbError) {
          console.error('Error recording deployment failure:', dbError);
        }
      }
      
      throw error;
    }
  };
  
  /**
   * Deploy dialplan content to an Asterisk server
   * @param {string} dialplan - Generated dialplan content
   * @param {Object} options - Deployment options
   * @returns {Object} Deployment results
   */
  const deployToAsterisk = async (dialplan, options) => {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      conn.on('ready', async () => {
        console.log('SSH connection established');
        
        try {
          // Create a temporary file
          const tempFile = path.join('/tmp', `dialplan_${Date.now()}.conf`);
          
          // Write dialplan to temp file
          await fs.writeFile(tempFile, dialplan);
          
          // Target path in Asterisk
          const targetPath = path.join(
            options.asteriskPath || '/etc/asterisk', 
            'extensions.conf'
          );
          
          // Backup existing config
          const backupPath = `${targetPath}.bak.${Date.now()}`;
          
          // Execute commands
          await executeCommand(conn, `cp ${targetPath} ${backupPath}`);
          await executeCommand(conn, `cp ${tempFile} ${targetPath}`);
          await executeCommand(conn, 'asterisk -rx "dialplan reload"');
          
          // Clean up temp file
          await fs.unlink(tempFile);
          
          conn.end();
          resolve({
            success: true,
            message: 'Dialplan deployed successfully',
            backupPath
          });
        } catch (error) {
          conn.end();
          reject(error);
        }
      });
      
      conn.on('error', (err) => {
        reject(new Error(`SSH connection error: ${err.message}`));
      });
      
      // Connect to SSH server
      const connOptions = {
        host: options.server,
        port: options.port || 22,
        username: options.username
      };
      
      if (options.password) {
        connOptions.password = options.password;
      } else if (options.privateKey) {
        connOptions.privateKey = options.privateKey;
      } else {
        reject(new Error('No authentication method provided'));
        return;
      }
      
      conn.connect(connOptions);
    });
  };
  
  /**
   * Execute a command via SSH
   * @param {Object} conn - SSH connection
   * @param {string} command - Command to execute
   * @returns {Promise<string>} Command output
   */
  const executeCommand = (conn, command) => {
    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`Command execution error: ${err.message}`));
          return;
        }
        
        let stdout = '';
        let stderr = '';
        
        stream.on('data', (data) => {
          stdout += data.toString();
        });
        
        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        stream.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Command failed (exit code ${code}): ${stderr}`));
          } else {
            resolve(stdout);
          }
        });
      });
    });
  };
  
  /**
   * Get deployment history for a project
   * @param {number} projectId - Project ID
   * @param {string} tenantId - Tenant ID
   * @param {number} limit - Limit number of entries
   * @returns {Array} Deployment history
   */
  const getDeploymentHistory = async (projectId, tenantId, limit = 10) => {
    try {
      const deployments = await DeploymentHistory.findAll({
        where: { projectId, tenantId },
        order: [['deployedAt', 'DESC']],
        limit
      });
      
      return deployments;
    } catch (error) {
      console.error('Error getting deployment history:', error);
      throw error;
    }
  };
  
  return {
    deployDialplan,
    getDeploymentHistory
  };
};
