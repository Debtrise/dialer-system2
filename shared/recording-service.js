// recording-service.js
// Clean recording service - SSH Asterisk integration only

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { Op } = require('sequelize');

class RecordingService {
  constructor(models) {
    this.models = models;
    this.recordingsDir = path.join(__dirname, '../recordings');
    
    // Remote Asterisk server configuration
    this.asteriskServer = {
      host: process.env.ASTERISK_SERVER_HOST || '34.29.105.211',
      port: process.env.ASTERISK_SERVER_PORT || '22',
      username: process.env.ASTERISK_SERVER_USER || 'root',
      keyPath: process.env.ASTERISK_SERVER_KEY || null,
      password: process.env.ASTERISK_SERVER_PASSWORD || null,
      soundsPath: process.env.ASTERISK_SOUNDS_PATH || '/var/lib/asterisk/sounds/custom',
      tempPath: '/tmp/knittt-recordings'
    };
  }

  /**
   * Initialize local recordings directory
   */
  async initializeDirectory() {
    try {
      await fs.access(this.recordingsDir);
    } catch {
      await fs.mkdir(this.recordingsDir, { recursive: true });
      console.log('Created local recordings directory');
    }
  }

  /**
   * Test SSH connection to Asterisk server
   */
  async testAsteriskConnection() {
    try {
      console.log(`Testing SSH connection to ${this.asteriskServer.host}...`);
      
      const sshCmd = this.buildSSHCommand('echo "SSH connection test successful"');
      const { stdout, stderr } = await exec(sshCmd);
      
      if (stderr && !stderr.includes('Warning')) {
        throw new Error(`SSH error: ${stderr}`);
      }
      
      return {
        success: true,
        message: 'SSH connection successful',
        host: this.asteriskServer.host,
        output: stdout.trim()
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        host: this.asteriskServer.host
      };
    }
  }

  /**
   * Build SSH command with proper authentication
   */
  buildSSHCommand(command, useSudo = false) {
    let sshCmd = '';
    
    // Use sshpass if password is configured
    if (this.asteriskServer.password && !this.asteriskServer.keyPath) {
      sshCmd = `sshpass -p '${this.asteriskServer.password}' ssh `;
    } else {
      sshCmd = 'ssh ';
    }
    
    sshCmd += '-o StrictHostKeyChecking=no ';
    sshCmd += '-o UserKnownHostsFile=/dev/null ';
    sshCmd += '-o ConnectTimeout=10 ';
    
    if (this.asteriskServer.port !== '22') {
      sshCmd += `-p ${this.asteriskServer.port} `;
    }
    
    if (this.asteriskServer.keyPath) {
      sshCmd += `-i ${this.asteriskServer.keyPath} `;
    }
    
    sshCmd += `${this.asteriskServer.username}@${this.asteriskServer.host} `;
    
    // Add sudo if needed and user is not root
    if (useSudo && this.asteriskServer.username !== 'root') {
      sshCmd += `"sudo ${command}"`;
    } else {
      sshCmd += `"${command}"`;
    }
    
    return sshCmd;
  }

  /**
   * Build SCP command for file transfer
   */
  buildSCPCommand(localFile, remoteFile) {
    let scpCmd = '';
    
    // Use sshpass if password is configured
    if (this.asteriskServer.password && !this.asteriskServer.keyPath) {
      scpCmd = `sshpass -p '${this.asteriskServer.password}' scp `;
    } else {
      scpCmd = 'scp ';
    }
    
    scpCmd += '-o StrictHostKeyChecking=no ';
    scpCmd += '-o UserKnownHostsFile=/dev/null ';
    scpCmd += '-o ConnectTimeout=30 ';
    
    if (this.asteriskServer.port !== '22') {
      scpCmd += `-P ${this.asteriskServer.port} `;
    }
    
    if (this.asteriskServer.keyPath) {
      scpCmd += `-i ${this.asteriskServer.keyPath} `;
    }
    
    scpCmd += `"${localFile}" `;
    scpCmd += `"${this.asteriskServer.username}@${this.asteriskServer.host}:${remoteFile}"`;
    
    return scpCmd;
  }

  /**
   * Create recording
   */
  async createRecording(tenantId, recordingData) {
    try {
      if (recordingData.elevenLabsVoiceId) {
        recordingData.elevenLabsVoiceId = this.validateVoiceId(recordingData.elevenLabsVoiceId);
      }

      const recording = await this.models.Recording.create({
        tenantId,
        ...recordingData,
        asteriskStatus: 'not_deployed',
        remoteDeployStatus: 'pending'
      });

      return recording;
    } catch (error) {
      console.error('Error creating recording:', error);
      throw error;
    }
  }

  /**
   * Get recording by ID and tenant
   */
  async getRecording(recordingId, tenantId) {
    try {
      const recording = await this.models.Recording.findOne({
        where: {
          id: recordingId,
          tenantId: tenantId
        },
        include: [{
          model: this.models.RecordingTemplate,
          as: 'RecordingTemplate',
          required: false
        }]
      });

      if (!recording) {
        throw new Error('Recording not found');
      }

      return recording;
    } catch (error) {
      console.error('Error getting recording:', error);
      throw error;
    }
  }

  /**
   * List recordings with filtering
   */
  async listRecordings(tenantId, options = {}) {
    try {
      const {
        type,
        isActive,
        page = 1,
        limit = 50
      } = options;

      const where = { tenantId };
      
      if (type) where.type = type;
      if (isActive !== undefined) where.isActive = isActive;

      const result = await this.models.Recording.findAndCountAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        include: [{
          model: this.models.RecordingTemplate,
          as: 'RecordingTemplate',
          required: false
        }]
      });

      return {
        recordings: result.rows,
        totalCount: result.count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(result.count / parseInt(limit))
      };
    } catch (error) {
      console.error('Error listing recordings:', error);
      throw error;
    }
  }

  /**
   * Update recording
   */
  async updateRecording(recordingId, tenantId, updateData) {
    try {
      const recording = await this.getRecording(recordingId, tenantId);
      
      if (updateData.elevenLabsVoiceId) {
        updateData.elevenLabsVoiceId = this.validateVoiceId(updateData.elevenLabsVoiceId);
      }

      await recording.update(updateData);
      return recording.reload();
    } catch (error) {
      console.error('Error updating recording:', error);
      throw error;
    }
  }

  /**
   * Delete recording
   */
  async deleteRecording(recordingId, tenantId) {
    try {
      const recording = await this.getRecording(recordingId, tenantId);
      
      // Delete from Asterisk if deployed
      if (recording.asteriskStatus === 'deployed') {
        await this.deleteFromAsterisk(recordingId, tenantId);
      }

      // Delete local file if exists
      if (recording.fileUrl) {
        const localFile = path.join(__dirname, '..', recording.fileUrl);
        try {
          await fs.unlink(localFile);
        } catch (error) {
          console.log('Local file already deleted or not found');
        }
      }

      await recording.destroy();
      
      return {
        message: 'Recording deleted successfully',
        deletedFromAsterisk: recording.asteriskStatus === 'deployed',
        deletedFile: recording.fileUrl
      };
    } catch (error) {
      console.error('Error deleting recording:', error);
      throw error;
    }
  }

  /**
   * Get Eleven Labs configuration for tenant
   */
  async getElevenLabsConfig(tenantId) {
    try {
      let config = await this.models.ElevenLabsConfig.findOne({
        where: { tenantId }
      });

      if (!config) {
        config = await this.models.ElevenLabsConfig.create({
          tenantId,
          defaultVoiceId: '21m00Tcm4TlvDq8ikWAM',
          monthlyCharacterLimit: 10000,
          charactersUsedThisMonth: 0
        });
      }

      return config;
    } catch (error) {
      console.error('Error getting Eleven Labs config:', error);
      throw error;
    }
  }

  /**
   * Validate voice ID format
   */
  validateVoiceId(voiceId) {
    if (!voiceId || typeof voiceId !== 'string') {
      throw new Error('Invalid voice ID format');
    }
    
    if (voiceId.length < 10 || voiceId.length > 50) {
      throw new Error('Voice ID must be between 10 and 50 characters');
    }
    
    return voiceId;
  }

  /**
   * Generate audio using Eleven Labs
   */
  async generateAudio(recordingId, tenantId) {
    try {
      const recording = await this.getRecording(recordingId, tenantId);
      const config = await this.getElevenLabsConfig(tenantId);

      if (!config.apiKey) {
        throw new Error('Eleven Labs API key not configured for tenant');
      }

      if (!recording.text || recording.text.trim().length === 0) {
        throw new Error('No text provided for audio generation');
      }

      const textLength = recording.text.length;
      
      if (config.charactersUsedThisMonth + textLength > config.monthlyCharacterLimit) {
        throw new Error('Monthly character limit exceeded');
      }

      const voiceId = recording.elevenLabsVoiceId || config.defaultVoiceId;
      
      console.log(`Generating audio for recording ${recordingId} with voice ${voiceId}`);
      
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: recording.text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8
          }
        },
        {
          headers: {
            'xi-api-key': config.apiKey,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );

      const fileName = `${tenantId}_${recordingId}_${Date.now()}.mp3`;
      const filePath = path.join(this.recordingsDir, fileName);
      
      await fs.writeFile(filePath, response.data);
      const stats = await fs.stat(filePath);

      await recording.update({
        fileUrl: `/recordings/${fileName}`,
        fileName,
        fileSize: stats.size,
        generatedAt: new Date()
      });

      await config.increment('charactersUsedThisMonth', { by: textLength });

      console.log(`Audio generated successfully for recording ${recordingId}`);
      return recording;

    } catch (error) {
      console.error('Error generating audio:', error);
      throw error;
    }
  }

  /**
   * Deploy recording to remote Asterisk server via SSH/SCP
   */
  async deployToAsterisk(recordingId, tenantId) {
    try {
      const recording = await this.getRecording(recordingId, tenantId);
      
      if (!recording.fileUrl || !recording.fileName) {
        throw new Error('Recording has no audio file to deploy');
      }

      console.log(`Deploying recording ${recordingId} to remote Asterisk server...`);

      await recording.update({ 
        asteriskStatus: 'deploying',
        remoteDeployStatus: 'in_progress' 
      });

      const localFile = path.join(__dirname, '..', recording.fileUrl);
      const asteriskFileName = `tenant_${tenantId}_${recordingId}.mp3`;
      const tempRemoteFile = `${this.asteriskServer.tempPath}/${asteriskFileName}`;
      const finalRemoteFile = `${this.asteriskServer.soundsPath}/${asteriskFileName}`;

      const isNonRoot = this.asteriskServer.username !== 'root';

      console.log('Creating temp directory on Asterisk server...');
      const mkdirCmd = this.buildSSHCommand(`mkdir -p ${this.asteriskServer.tempPath}`, isNonRoot);
      await exec(mkdirCmd);

      console.log('Copying file to Asterisk server...');
      const scpCmd = this.buildSCPCommand(localFile, tempRemoteFile);
      const { stderr: scpStderr } = await exec(scpCmd);
      
      if (scpStderr && !scpStderr.includes('Warning')) {
        throw new Error(`SCP failed: ${scpStderr}`);
      }

      console.log('Moving file to final location...');
      let moveAndPermissionsCmd;
      
      if (isNonRoot) {
        // Use sudo for non-root users - skip chown since directory has setgid
        moveAndPermissionsCmd = this.buildSSHCommand(
          `mkdir -p ${this.asteriskServer.soundsPath} && ` +
          `mv ${tempRemoteFile} ${finalRemoteFile} && ` +
          `chmod 664 ${finalRemoteFile} && ` +
          `ls -la ${finalRemoteFile}`,
          true // use sudo
        );
      } else {
        // Original command for root
        moveAndPermissionsCmd = this.buildSSHCommand(`
          mkdir -p ${this.asteriskServer.soundsPath} && 
          mv ${tempRemoteFile} ${finalRemoteFile} && 
          chown asterisk:asterisk ${finalRemoteFile} && 
          chmod 664 ${finalRemoteFile} && 
          ls -la ${finalRemoteFile}
        `);
      }
      
      const { stdout: moveOutput } = await exec(moveAndPermissionsCmd);
      console.log('File deployed:', moveOutput.trim());

      const verifyCmd = this.buildSSHCommand(`
        if [ -f ${finalRemoteFile} ]; then 
          echo "SUCCESS: $(ls -lh ${finalRemoteFile})"; 
        else 
          echo "ERROR: File not found at ${finalRemoteFile}"; 
          exit 1; 
        fi
      `, isNonRoot);
      
      const { stdout: verifyOutput } = await exec(verifyCmd);
      
      if (!verifyOutput.includes('SUCCESS')) {
        throw new Error(`File verification failed: ${verifyOutput}`);
      }

      await recording.update({
        asteriskStatus: 'deployed',
        asteriskPath: asteriskFileName,
        asteriskDeployedAt: new Date(),
        asteriskError: null,
        remoteDeployStatus: 'completed',
        remoteFilePath: finalRemoteFile
      });

      console.log(`✅ Recording ${recordingId} deployed successfully to Asterisk server`);

      return {
        success: true,
        asteriskPath: asteriskFileName,
        remoteFilePath: finalRemoteFile,
        deployedAt: new Date(),
        fileInfo: verifyOutput.trim(),
        message: 'Recording deployed to remote Asterisk server successfully'
      };

    } catch (error) {
      console.error('Error deploying to remote Asterisk:', error);
      
      const recording = await this.getRecording(recordingId, tenantId);
      await recording.update({
        asteriskStatus: 'failed',
        asteriskError: error.message,
        remoteDeployStatus: 'failed'
      });

      throw error;
    }
  }

  /**
   * List recordings on remote Asterisk server for a tenant
   */
  async listRemoteRecordings(tenantId) {
    try {
      const isNonRoot = this.asteriskServer.username !== 'root';
      const listCmd = this.buildSSHCommand(
        `ls -la ${this.asteriskServer.soundsPath}/tenant_${tenantId}_* 2>/dev/null || echo "No recordings found"`,
        isNonRoot
      );
      
      const { stdout } = await exec(listCmd);
      
      const recordings = [];
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        if (line.includes(`tenant_${tenantId}_`)) {
          const parts = line.split(/\s+/);
          const filename = parts[parts.length - 1];
          const size = parts[4];
          const date = `${parts[5]} ${parts[6]} ${parts[7]}`;
          
          recordings.push({
            filename,
            size,
            lastModified: date,
            fullPath: `${this.asteriskServer.soundsPath}/${filename}`
          });
        }
      }
      
      return recordings;
      
    } catch (error) {
      console.error('Error listing remote recordings:', error);
      return [];
    }
  }

  /**
   * Delete recording from remote Asterisk server
   */
  async deleteFromAsterisk(recordingId, tenantId) {
    try {
      const recording = await this.getRecording(recordingId, tenantId);
      
      if (recording.asteriskStatus === 'deployed' && recording.asteriskPath) {
        const remoteFile = `${this.asteriskServer.soundsPath}/${recording.asteriskPath}`;
        const isNonRoot = this.asteriskServer.username !== 'root';
        
        const deleteCmd = this.buildSSHCommand(
          `if [ -f ${remoteFile} ]; then rm ${remoteFile} && echo "Deleted ${remoteFile}"; else echo "File not found: ${remoteFile}"; fi`,
          isNonRoot
        );
        
        const { stdout } = await exec(deleteCmd);
        console.log('Delete result:', stdout.trim());
        
        return { success: true, message: stdout.trim() };
      }
      
      return { success: true, message: 'No remote file to delete' };
      
    } catch (error) {
      console.error('Error deleting from remote Asterisk:', error);
      throw error;
    }
  }

  /**
   * Get Asterisk playback path for AMI/dialplan use
   */
  getAsteriskPlaybackPath(recording) {
    if (recording.asteriskStatus !== 'deployed' || !recording.asteriskPath) {
      throw new Error('Recording not deployed to Asterisk');
    }
    
    return `custom/${recording.asteriskPath.replace('.mp3', '')}`;
  }

  /**
   * Setup remote Asterisk server (create directories, set permissions)
   */
  async setupRemoteServer() {
    try {
      console.log('Setting up remote Asterisk server...');
      const isNonRoot = this.asteriskServer.username !== 'root';
      
      const setupCmd = this.buildSSHCommand(
        `mkdir -p ${this.asteriskServer.soundsPath} && ` +
        `mkdir -p ${this.asteriskServer.tempPath} && ` +
        (isNonRoot ? '' : `chown asterisk:asterisk ${this.asteriskServer.soundsPath} 2>/dev/null || echo "Warning: Could not set asterisk ownership" && `) +
        `chmod 755 ${this.asteriskServer.soundsPath} && ` +
        `chmod 755 ${this.asteriskServer.tempPath} && ` +
        `echo "Setup complete:" && ` +
        `ls -la ${this.asteriskServer.soundsPath} && ` +
        `echo "Temp directory:" && ` +
        `ls -la ${this.asteriskServer.tempPath}`,
        isNonRoot
      );
      
      const { stdout } = await exec(setupCmd);
      
      return {
        success: true,
        message: 'Remote server setup completed',
        output: stdout
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Remote server setup failed'
      };
    }
  }

  /**
   * Track recording usage
   */
  async trackUsage(recordingId, tenantId, usageData) {
    try {
      const recording = await this.getRecording(recordingId, tenantId);
      
      await this.models.RecordingUsageLog.create({
        recordingId,
        tenantId,
        usedAt: new Date(),
        ...usageData
      });

      await recording.update({
        usageCount: recording.usageCount + 1,
        lastUsed: new Date()
      });

      return { success: true };
    } catch (error) {
      console.error('Error tracking usage:', error);
      throw error;
    }
  }

  /**
   * Get recording analytics
   */
  async getRecordingAnalytics(recordingId, tenantId, options = {}) {
    try {
      const { startDate, endDate } = options;
      
      const where = {
        recordingId,
        tenantId
      };

      if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date[Op.gte] = startDate;
        if (endDate) where.date[Op.lte] = endDate;
      }

      const analytics = await this.models.RecordingAnalytics.findAll({
        where,
        order: [['date', 'DESC']]
      });

      return {
        recordingId,
        period: { startDate, endDate },
        analytics
      };
    } catch (error) {
      console.error('Error getting recording analytics:', error);
      throw error;
    }
  }

  /**
   * Create recording template
   */
  async createTemplate(tenantId, templateData) {
    try {
      const template = await this.models.RecordingTemplate.create({
        tenantId,
        ...templateData
      });

      return template;
    } catch (error) {
      console.error('Error creating template:', error);
      throw error;
    }
  }

  /**
   * Generate recording from template
   */
  async generateFromTemplate(templateId, tenantId, variables, recordingData) {
    try {
      const template = await this.models.RecordingTemplate.findOne({
        where: { id: templateId, tenantId }
      });

      if (!template) {
        throw new Error('Template not found');
      }

      let finalText = template.textTemplate;
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        finalText = finalText.replace(regex, value);
      }

      const recording = await this.createRecording(tenantId, {
        ...recordingData,
        text: finalText,
        templateId: template.id,
        elevenLabsVoiceId: recordingData.voiceId || template.defaultVoiceId
      });

      return recording;
    } catch (error) {
      console.error('Error generating from template:', error);
      throw error;
    }
  }
}

module.exports = RecordingService;