// remote-asterisk-recording-service.js
// Recording service that generates audio locally and deploys to remote Asterisk server via SSH

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

class RemoteAsteriskRecordingService {
  constructor(models) {
    this.models = models;
    this.recordingsDir = path.join(__dirname, '../recordings');
    
    // Remote Asterisk server configuration
    this.asteriskServer = {
      host: process.env.ASTERISK_SERVER_HOST || '34.29.105.211',
      port: process.env.ASTERISK_SERVER_PORT || '22',
      username: process.env.ASTERISK_SERVER_USER || 'root',
      keyPath: process.env.ASTERISK_SERVER_KEY || null, // SSH key path
      password: process.env.ASTERISK_SERVER_PASSWORD || null, // Alternative to key
      soundsPath: process.env.ASTERISK_SOUNDS_PATH || '/var/lib/asterisk/sounds/custom',
      tempPath: '/tmp/knittt-recordings' // Temp path on Asterisk server
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
      
      // Build SSH command
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
  buildSSHCommand(command) {
    let sshCmd = 'ssh ';
    
    // Add SSH options
    sshCmd += '-o StrictHostKeyChecking=no ';
    sshCmd += '-o UserKnownHostsFile=/dev/null ';
    sshCmd += '-o ConnectTimeout=10 ';
    
    // Add port if specified
    if (this.asteriskServer.port !== '22') {
      sshCmd += `-p ${this.asteriskServer.port} `;
    }
    
    // Add key authentication if specified
    if (this.asteriskServer.keyPath) {
      sshCmd += `-i ${this.asteriskServer.keyPath} `;
    }
    
    // Add user and host
    sshCmd += `${this.asteriskServer.username}@${this.asteriskServer.host} `;
    
    // Add the command
    sshCmd += `"${command}"`;
    
    return sshCmd;
  }

  /**
   * Build SCP command for file transfer
   */
  buildSCPCommand(localFile, remoteFile) {
    let scpCmd = 'scp ';
    
    // Add SCP options
    scpCmd += '-o StrictHostKeyChecking=no ';
    scpCmd += '-o UserKnownHostsFile=/dev/null ';
    scpCmd += '-o ConnectTimeout=30 ';
    
    // Add port if specified
    if (this.asteriskServer.port !== '22') {
      scpCmd += `-P ${this.asteriskServer.port} `;
    }
    
    // Add key authentication if specified
    if (this.asteriskServer.keyPath) {
      scpCmd += `-i ${this.asteriskServer.keyPath} `;
    }
    
    // Add source and destination
    scpCmd += `"${localFile}" `;
    scpCmd += `"${this.asteriskServer.username}@${this.asteriskServer.host}:${remoteFile}"`;
    
    return scpCmd;
  }

  /**
   * Create recording (same as before)
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
   * Generate audio using Eleven Labs (same as before)
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

      // Save audio file locally
      const fileName = `${tenantId}_${recordingId}_${Date.now()}.mp3`;
      const filePath = path.join(this.recordingsDir, fileName);
      
      await fs.writeFile(filePath, response.data);
      const stats = await fs.stat(filePath);

      // Update recording with file info
      await recording.update({
        fileUrl: `/recordings/${fileName}`,
        fileName,
        fileSize: stats.size,
        generatedAt: new Date()
      });

      // Update character usage
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

      // Update status to deploying
      await recording.update({ 
        asteriskStatus: 'deploying',
        remoteDeployStatus: 'in_progress' 
      });

      const localFile = path.join(__dirname, '..', recording.fileUrl);
      const asteriskFileName = `tenant_${tenantId}_${recordingId}.mp3`;
      const tempRemoteFile = `${this.asteriskServer.tempPath}/${asteriskFileName}`;
      const finalRemoteFile = `${this.asteriskServer.soundsPath}/${asteriskFileName}`;

      // Step 1: Ensure temp directory exists on remote server
      console.log('Creating temp directory on Asterisk server...');
      const mkdirCmd = this.buildSSHCommand(`mkdir -p ${this.asteriskServer.tempPath}`);
      await exec(mkdirCmd);

      // Step 2: Copy file to temp location on remote server
      console.log('Copying file to Asterisk server...');
      const scpCmd = this.buildSCPCommand(localFile, tempRemoteFile);
      const { stderr: scpStderr } = await exec(scpCmd);
      
      if (scpStderr && !scpStderr.includes('Warning')) {
        throw new Error(`SCP failed: ${scpStderr}`);
      }

      // Step 3: Move file to final location and set permissions
      console.log('Moving file to final location...');
      const moveAndPermissionsCmd = this.buildSSHCommand(`
        mkdir -p ${this.asteriskServer.soundsPath} && 
        mv ${tempRemoteFile} ${finalRemoteFile} && 
        chown asterisk:asterisk ${finalRemoteFile} 2>/dev/null || true && 
        chmod 644 ${finalRemoteFile} && 
        ls -la ${finalRemoteFile}
      `);
      
      const { stdout: moveOutput } = await exec(moveAndPermissionsCmd);
      console.log('File deployed:', moveOutput.trim());

      // Step 4: Verify file exists and get info
      const verifyCmd = this.buildSSHCommand(`
        if [ -f ${finalRemoteFile} ]; then 
          echo "SUCCESS: $(ls -lh ${finalRemoteFile})"; 
        else 
          echo "ERROR: File not found at ${finalRemoteFile}"; 
          exit 1; 
        fi
      `);
      
      const { stdout: verifyOutput } = await exec(verifyCmd);
      
      if (!verifyOutput.includes('SUCCESS')) {
        throw new Error(`File verification failed: ${verifyOutput}`);
      }

      // Update recording with success status
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
        localFile: localFile,
        deployedAt: new Date(),
        fileInfo: verifyOutput.trim(),
        message: 'Recording deployed to remote Asterisk server successfully'
      };

    } catch (error) {
      console.error('Error deploying to remote Asterisk:', error);
      
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
      const listCmd = this.buildSSHCommand(`
        ls -la ${this.asteriskServer.soundsPath}/tenant_${tenantId}_* 2>/dev/null || echo "No recordings found"
      `);
      
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
        
        const deleteCmd = this.buildSSHCommand(`
          if [ -f ${remoteFile} ]; then 
            rm ${remoteFile} && echo "Deleted ${remoteFile}"; 
          else 
            echo "File not found: ${remoteFile}"; 
          fi
        `);
        
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
    
    // Return path relative to Asterisk sounds directory
    // Remove .mp3 extension as Asterisk adds it automatically
    return `custom/${recording.asteriskPath.replace('.mp3', '')}`;
  }

  /**
   * Setup remote Asterisk server (create directories, set permissions)
   */
  async setupRemoteServer() {
    try {
      console.log('Setting up remote Asterisk server...');
      
      const setupCmd = this.buildSSHCommand(`
        # Create directories
        mkdir -p ${this.asteriskServer.soundsPath} && 
        mkdir -p ${this.asteriskServer.tempPath} && 
        
        # Set ownership (try to, but don't fail if asterisk user doesn't exist)
        chown asterisk:asterisk ${this.asteriskServer.soundsPath} 2>/dev/null || echo "Warning: Could not set asterisk ownership" && 
        
        # Set permissions
        chmod 755 ${this.asteriskServer.soundsPath} && 
        chmod 755 ${this.asteriskServer.tempPath} && 
        
        # Report status
        echo "Setup complete:" && 
        ls -la ${this.asteriskServer.soundsPath} && 
        echo "Temp directory:" && 
        ls -la ${this.asteriskServer.tempPath}
      `);
      
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

  // ... (include other methods from previous service like getRecording, validateVoiceId, etc.)
  
  /**
   * Get recording by ID
   */
  async getRecording(recordingId, tenantId) {
    const recording = await this.models.Recording.findOne({
      where: { id: recordingId, tenantId }
    });

    if (!recording) {
      throw new Error('Recording not found');
    }

    return recording;
  }

  /**
   * Validate voice ID
   */
  validateVoiceId(voiceId) {
    if (typeof voiceId === 'string' && /^[a-zA-Z0-9]{20,25}$/.test(voiceId)) {
      return voiceId;
    }
    return '21m00Tcm4TlvDq8ikWAM';
  }

  /**
   * Get Eleven Labs configuration
   */
  async getElevenLabsConfig(tenantId) {
    let config = await this.models.ElevenLabsConfig.findOne({
      where: { tenantId }
    });

    if (!config) {
      config = await this.models.ElevenLabsConfig.create({
        tenantId,
        apiKey: process.env.ELEVEN_LABS_API_KEY || '',
        defaultVoiceId: '21m00Tcm4TlvDq8ikWAM',
        monthlyCharacterLimit: 50000,
        charactersUsedThisMonth: 0,
        lastResetDate: new Date()
      });
    }

    return config;
  }
}

module.exports = RecordingService;