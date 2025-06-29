// recording-routes.js
// Clean recording routes - SSH Asterisk integration only

const express = require('express');
const RecordingService = require('./recording-service');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const { Op } = require('sequelize');

module.exports = function(app, sequelize, authenticateToken) {
  const router = express.Router();
  
  // Initialize models
  const recordingModels = require('./recording-models')(sequelize, sequelize.Sequelize.DataTypes);
  
  // Initialize service
  const recordingService = new RecordingService({
    ...recordingModels,
    Template: sequelize.models.Template
  });
  
  // Initialize recordings directory
  recordingService.initializeDirectory();
  
  // In-memory cache for previews
  const previewCache = new Map();
  
  // Text validation helper function
  const validateTextForTTS = (text) => {
    const errors = [];
    const cleanText = text.trim();
    
    // Basic checks
    if (cleanText.length === 0) {
      errors.push('Text cannot be empty');
      return { isValid: false, errors, cleanText: '' };
    }
    
    if (cleanText.length > 5000) {
      errors.push('Text is too long (maximum 5000 characters)');
      return { isValid: false, errors, cleanText };
    }
    
    // Check for valid characters (letters, numbers, basic punctuation, spaces)
    const validTextRegex = /^[a-zA-Z0-9\s.,!?'"()\-:;]+$/;
    if (!validTextRegex.test(cleanText)) {
      errors.push('Text contains invalid characters. Please use only letters, numbers, and basic punctuation.');
      return { isValid: false, errors, cleanText };
    }
    
    // Advanced gibberish detection for longer texts
    if (cleanText.length > 10) {
      const words = cleanText.toLowerCase().split(/\s+/);
      
      // Common English words for recognition
      const commonWords = new Set([
        'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it', 'its', 
        'of', 'on', 'that', 'the', 'to', 'was', 'will', 'with', 'hello', 'hi', 'welcome', 'thanks', 'please', 
        'this', 'your', 'have', 'they', 'we', 'you', 'me', 'my', 'can', 'could', 'would', 'should', 'may', 
        'might', 'do', 'does', 'did', 'get', 'got', 'go', 'going', 'come', 'came', 'see', 'saw', 'look', 
        'take', 'give', 'make', 'know', 'think', 'say', 'tell', 'call', 'help', 'need', 'want', 'like', 
        'love', 'time', 'day', 'year', 'way', 'work', 'life', 'man', 'woman', 'child', 'people', 'world',
        'test', 'voice', 'sample', 'recording', 'audio', 'sound', 'speech', 'message', 'phone', 'number'
      ]);
      
      // Count recognizable words
      const recognizableWords = words.filter(word => {
        if (word.length < 2) return false;
        // Check common words or words that look like real English words
        return commonWords.has(word) || /^[a-z]{2,}$/.test(word);
      });
      
      // Calculate recognition ratio
      const recognitionRatio = recognizableWords.length / words.length;
      
      // If less than 40% of words are recognizable, it's likely gibberish
      if (words.length > 2 && recognitionRatio < 0.4) {
        errors.push('Text appears to contain mostly gibberish. Please use readable words for better audio generation.');
        return { isValid: false, errors, cleanText };
      }
      
      // Check for excessive repetition of characters or patterns
      const repeatingPattern = /(.)\1{4,}|(.{2,})\2{3,}/;
      if (repeatingPattern.test(cleanText)) {
        errors.push('Text contains excessive repetition. Please use varied, natural language.');
        return { isValid: false, errors, cleanText };
      }
      
      // Check for keyboard mashing patterns
      const keyboardMashing = /[qwertyuiop]{4,}|[asdfghjkl]{4,}|[zxcvbnm]{4,}/i;
      if (keyboardMashing.test(cleanText)) {
        errors.push('Text appears to be keyboard mashing. Please enter meaningful words.');
        return { isValid: false, errors, cleanText };
      }
    }
    
    return { isValid: true, errors: [], cleanText };
  };
  
  // Voice settings validation helper
  const getValidVoiceSettings = (config) => {
    // Always return a proper voice settings object, never a string
    if (config.voiceSettings && typeof config.voiceSettings === 'object') {
      return {
        stability: parseFloat(config.voiceSettings.stability) || 0.5,
        similarity_boost: parseFloat(config.voiceSettings.similarity_boost) || 0.8,
        ...config.voiceSettings
      };
    }
    
    // Default voice settings
    return {
      stability: 0.5,
      similarity_boost: 0.8
    };
  };
  
  // Configure multer for file uploads
  const upload = multer({
    storage: multer.diskStorage({
      destination: async (req, file, cb) => {
        cb(null, path.join(__dirname, '../recordings'));
      },
      filename: (req, file, cb) => {
        const uniqueName = `${req.user.tenantId}_upload_${Date.now()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
      }
    }),
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = ['.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.flac'];
      const allowedMimeTypes = [
        'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
        'audio/ogg', 'audio/x-m4a', 'audio/mp4', 'audio/webm', 'audio/flac',
        'application/octet-stream'
      ];
      
      const ext = path.extname(file.originalname).toLowerCase();
      const mimeType = file.mimetype.toLowerCase();
      
      if (allowedTypes.includes(ext) || allowedMimeTypes.includes(mimeType)) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file type. Extension: ${ext}, MIME: ${mimeType}`));
      }
    }
  });

  // ===== CORE RECORDING ROUTES =====
  
  // List recordings
  router.get('/recordings', authenticateToken, async (req, res) => {
    try {
      const options = {
        type: req.query.type,
        isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
        page: req.query.page || 1,
        limit: req.query.limit || 50
      };
      
      const result = await recordingService.listRecordings(req.user.tenantId, options);
      res.json(result);
    } catch (error) {
      console.error('Error listing recordings:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get single recording
  router.get('/recordings/:id', authenticateToken, async (req, res) => {
    try {
      const recording = await recordingService.getRecording(
        req.params.id,
        req.user.tenantId
      );
      res.json(recording);
    } catch (error) {
      console.error('Error getting recording:', error);
      res.status(404).json({ error: error.message });
    }
  });

  // Create recording
  router.post('/recordings', authenticateToken, async (req, res) => {
    try {
      const recording = await recordingService.createRecording(
        req.user.tenantId,
        req.body
      );
      res.status(201).json(recording);
    } catch (error) {
      console.error('Error creating recording:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Update recording
  router.put('/recordings/:id', authenticateToken, async (req, res) => {
    try {
      const recording = await recordingService.updateRecording(
        req.params.id,
        req.user.tenantId,
        req.body
      );
      res.json(recording);
    } catch (error) {
      console.error('Error updating recording:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Delete recording
  router.delete('/recordings/:id', authenticateToken, async (req, res) => {
    try {
      const result = await recordingService.deleteRecording(
        req.params.id,
        req.user.tenantId
      );
      res.json(result);
    } catch (error) {
      console.error('Error deleting recording:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== BULK OPERATIONS =====

  // Bulk operations for multiple recordings
  router.post('/recordings/bulk/:action', authenticateToken, async (req, res) => {
    try {
      const { action } = req.params;
      const { recordingIds, options = {} } = req.body;
      
      if (!recordingIds || !Array.isArray(recordingIds) || recordingIds.length === 0) {
        return res.status(400).json({ error: 'recordingIds array is required' });
      }

      const validActions = ['deploy-to-asterisk', 'generate-audio', 'delete'];
      if (!validActions.includes(action)) {
        return res.status(400).json({ 
          error: `Invalid action. Valid actions: ${validActions.join(', ')}` 
        });
      }

      console.log(`Bulk ${action} operation for ${recordingIds.length} recordings`);

      const results = {
        action,
        totalRecordings: recordingIds.length,
        successful: 0,
        failed: 0,
        results: [],
        errors: []
      };

      // Process each recording
      for (const recordingId of recordingIds) {
        try {
          let result;
          
          switch (action) {
            case 'deploy-to-asterisk':
              result = await recordingService.deployToAsterisk(recordingId, req.user.tenantId);
              break;
              
            case 'generate-audio':
              result = await recordingService.generateAudio(recordingId, req.user.tenantId);
              break;
              
            case 'delete':
              if (!options.force) {
                const recording = await recordingService.getRecording(recordingId, req.user.tenantId);
                if (recording.usageCount > 0 && !options.force) {
                  throw new Error(`Recording ${recordingId} has been used ${recording.usageCount} times. Use force=true to delete.`);
                }
              }
              result = await recordingService.deleteRecording(recordingId, req.user.tenantId);
              break;
          }
          
          results.successful++;
          results.results.push({
            recordingId,
            success: true,
            result
          });
          
        } catch (error) {
          results.failed++;
          results.errors.push({
            recordingId,
            error: error.message
          });
          
          console.error(`Bulk ${action} failed for recording ${recordingId}:`, error.message);
        }
      }

      res.json(results);
      
    } catch (error) {
      console.error('Error in bulk operation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== AUDIO GENERATION & FILE MANAGEMENT =====

  // Generate audio using Eleven Labs
  router.post('/recordings/:id/generate', authenticateToken, async (req, res) => {
    try {
      const recording = await recordingService.generateAudio(
        req.params.id,
        req.user.tenantId
      );
      
      res.json({
        id: recording.id,
        fileName: recording.fileName,
        fileUrl: recording.fileUrl,
        fileSize: recording.fileSize,
        generatedAt: recording.generatedAt,
        message: 'Audio generated successfully'
      });
    } catch (error) {
      console.error('Error generating audio:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Upload audio file
  router.post('/recordings/:id/upload', authenticateToken, upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const recording = await recordingService.getRecording(
        req.params.id,
        req.user.tenantId
      );

      await recording.update({
        fileUrl: `/recordings/${req.file.filename}`,
        fileName: req.file.filename,
        fileSize: req.file.size,
        generatedAt: new Date()
      });

      res.json({
        success: true,
        message: 'File uploaded successfully',
        recording: {
          id: recording.id,
          fileName: recording.fileName,
          fileSize: recording.fileSize,
          generatedAt: recording.generatedAt
        }
      });
    } catch (error) {
      console.error('Error uploading file:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Serve audio files
  router.get('/recordings/:id/audio', authenticateToken, async (req, res) => {
    try {
      const recording = await recordingService.getRecording(
        req.params.id,
        req.user.tenantId
      );
      
      if (!recording.fileUrl) {
        return res.status(404).json({ error: 'Audio file not found' });
      }
      
      const filePath = path.join(__dirname, '..', recording.fileUrl);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Audio file not found on disk' });
      }
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `inline; filename="${recording.fileName}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
      // Track usage
      recordingService.trackUsage(recording.id, req.user.tenantId, {
        context: 'audio_download',
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      
    } catch (error) {
      console.error('Error serving audio file:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== PREVIEW & STREAMING =====

  // Generate preview with caching and improved validation
  router.post('/recordings/preview', authenticateToken, async (req, res) => {
    const startTime = Date.now();
    const requestId = crypto.randomBytes(4).toString('hex');
    
    try {
      console.log(`[${requestId}] Preview request started for tenant ${req.user.tenantId}`);
      
      const { text, voiceId } = req.body;
      
      if (!text || typeof text !== 'string') {
        console.log(`[${requestId}] Validation failed: No text provided`);
        return res.status(400).json({ error: 'Text is required for preview' });
      }
      
      if (text.length > 500) {
        console.log(`[${requestId}] Validation failed: Text too long (${text.length} chars)`);
        return res.status(400).json({ error: 'Preview text limited to 500 characters' });
      }

      console.log(`[${requestId}] Validating text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

      // Validate text using our helper function
      const validation = validateTextForTTS(text);
      if (!validation.isValid) {
        console.log(`[${requestId}] Text validation failed:`, validation.errors);
        return res.status(400).json({ 
          error: validation.errors[0],
          allErrors: validation.errors
        });
      }

      const cleanText = validation.cleanText;
      console.log(`[${requestId}] Text validation passed. Clean text: "${cleanText}"`);
      
      const cacheKey = crypto.createHash('md5')
        .update(`${req.user.tenantId}:${cleanText}:${voiceId || 'default'}`)
        .digest('hex');
      
      // Check cache first
      if (previewCache.has(cacheKey)) {
        const cached = previewCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 3600000) { // 1 hour cache
          console.log(`[${requestId}] Returning cached result`);
          return res.json({
            audioUrl: `/api/recordings/preview/cache/${cacheKey}`,
            cacheKey,
            cached: true,
            expiresAt: new Date(cached.timestamp + 3600000)
          });
        } else {
          console.log(`[${requestId}] Cache expired, deleting entry`);
          previewCache.delete(cacheKey);
        }
      }
      
      console.log(`[${requestId}] Getting Eleven Labs config...`);
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      if (!config.apiKey) {
        console.log(`[${requestId}] Error: No API key configured`);
        return res.status(400).json({ error: 'Eleven Labs API key not configured' });
      }
      
      if (config.apiKey === '***HIDDEN***') {
        console.log(`[${requestId}] Error: API key is hidden placeholder`);
        return res.status(400).json({ error: 'Please configure a valid Eleven Labs API key' });
      }
      
      const finalVoiceId = voiceId || config.defaultVoiceId;
      const voiceSettings = getValidVoiceSettings(config);
      
      console.log(`[${requestId}] Starting API call to Eleven Labs:`);
      console.log(`[${requestId}] - Voice ID: ${finalVoiceId}`);
      console.log(`[${requestId}] - Text length: ${cleanText.length} chars`);
      console.log(`[${requestId}] - Voice settings:`, JSON.stringify(voiceSettings));
      console.log(`[${requestId}] - API key (first 8 chars): ${config.apiKey.substring(0, 8)}...`);
      
      const requestPayload = {
        text: cleanText,
        model_id: 'eleven_monolingual_v1',
        voice_settings: voiceSettings
      };
      
      console.log(`[${requestId}] Request payload:`, JSON.stringify(requestPayload, null, 2));
      
      try {
        console.log(`[${requestId}] Making axios request to Eleven Labs...`);
        
        const axiosConfig = {
          headers: {
            'xi-api-key': config.apiKey,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer',
          timeout: 30000,
          validateStatus: function (status) {
            console.log(`[${requestId}] Received status code: ${status}`);
            return status >= 200 && status < 300;
          }
        };
        
        console.log(`[${requestId}] Axios config:`, {
          ...axiosConfig,
          headers: {
            ...axiosConfig.headers,
            'xi-api-key': config.apiKey.substring(0, 8) + '...'
          }
        });
        
        const response = await axios.post(
          `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`,
          requestPayload,
          axiosConfig
        );
        
        console.log(`[${requestId}] Received response from Eleven Labs:`);
        console.log(`[${requestId}] - Status: ${response.status}`);
        console.log(`[${requestId}] - Headers:`, response.headers);
        console.log(`[${requestId}] - Data length: ${response.data ? response.data.byteLength : 'undefined'} bytes`);
        
        // Validate that we received audio data
        if (!response.data || response.data.byteLength === 0) {
          console.error(`[${requestId}] Error: No audio data received from Eleven Labs`);
          throw new Error('No audio data received from Eleven Labs');
        }
        
        // Check if response is actually HTML (error page) instead of audio
        const responseText = new TextDecoder().decode(response.data.slice(0, 100));
        console.log(`[${requestId}] Response preview (first 100 bytes):`, responseText.substring(0, 50));
        
        if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
          console.error(`[${requestId}] Error: Received HTML instead of audio data`);
          throw new Error('Invalid API response - received HTML instead of audio data');
        }
        
        console.log(`[${requestId}] Audio data validated successfully`);
        
        // Cache the audio data
        previewCache.set(cacheKey, {
          audioData: response.data,
          timestamp: Date.now(),
          contentType: 'audio/mpeg'
        });
        
        console.log(`[${requestId}] Audio cached with key: ${cacheKey}`);
        
        // Update character usage
        await config.increment('charactersUsedThisMonth', { by: cleanText.length });
        console.log(`[${requestId}] Updated character usage: +${cleanText.length} chars`);
        
        const responseData = {
          audioUrl: `/api/recordings/preview/cache/${cacheKey}`,
          cacheKey,
          cached: false,
          expiresAt: new Date(Date.now() + 3600000),
          charactersUsed: cleanText.length
        };
        
        const totalTime = Date.now() - startTime;
        console.log(`[${requestId}] Preview generation completed successfully in ${totalTime}ms`);
        
        res.json(responseData);
        
      } catch (apiError) {
        const totalTime = Date.now() - startTime;
        console.error(`[${requestId}] Eleven Labs API error after ${totalTime}ms:`, {
          message: apiError.message,
          code: apiError.code,
          status: apiError.response?.status,
          statusText: apiError.response?.statusText,
          headers: apiError.response?.headers,
          data: apiError.response?.data ? 'Present' : 'None'
        });
        
        // Handle specific Eleven Labs API errors
        if (apiError.response) {
          const status = apiError.response.status;
          const statusText = apiError.response.statusText;
          
          console.log(`[${requestId}] API response status: ${status} ${statusText}`);
          
          // Try to get the actual error message from the response
          let errorDetail = '';
          try {
            if (apiError.response.data) {
              const errorData = Buffer.isBuffer(apiError.response.data) 
                ? JSON.parse(apiError.response.data.toString()) 
                : apiError.response.data;
              
              console.log(`[${requestId}] API error data:`, errorData);
              
              if (errorData.detail) {
                errorDetail = Array.isArray(errorData.detail) 
                  ? errorData.detail.map(d => d.msg || d.message || d).join(', ')
                  : errorData.detail;
              }
            }
          } catch (parseError) {
            console.log(`[${requestId}] Could not parse error details:`, parseError.message);
          }
          
          switch (status) {
            case 401:
              console.log(`[${requestId}] Authentication failed`);
              return res.status(400).json({ 
                error: 'Invalid Eleven Labs API key. Please check your configuration.' 
              });
            case 403:
              console.log(`[${requestId}] Access denied`);
              return res.status(400).json({ 
                error: 'Eleven Labs API access denied. Check your subscription status.' 
              });
            case 404:
              console.log(`[${requestId}] Voice not found`);
              return res.status(400).json({ 
                error: `Voice ID "${finalVoiceId}" not found. Please select a valid voice.` 
              });
            case 422:
              console.log(`[${requestId}] Invalid request data:`, errorDetail);
              const detailedError = errorDetail 
                ? `Invalid request: ${errorDetail}` 
                : 'Invalid text for speech synthesis. Please use readable text with proper words and punctuation.';
              return res.status(400).json({ 
                error: detailedError
              });
            case 429:
              console.log(`[${requestId}] Rate limit exceeded`);
              return res.status(400).json({ 
                error: 'Rate limit exceeded. Please wait before trying again.' 
              });
            case 500:
              console.log(`[${requestId}] Server error`);
              return res.status(400).json({ 
                error: 'Eleven Labs service temporarily unavailable. Please try again later.' 
              });
            default:
              console.log(`[${requestId}] Unexpected status code: ${status}`);
              return res.status(400).json({ 
                error: `Eleven Labs API error (${status}): ${errorDetail || statusText}` 
              });
          }
        } else if (apiError.code === 'ECONNABORTED') {
          console.log(`[${requestId}] Request timed out`);
          return res.status(400).json({ 
            error: 'Request timeout. The Eleven Labs service is taking too long to respond.' 
          });
        } else if (apiError.code === 'ENOTFOUND' || apiError.code === 'ECONNREFUSED') {
          console.log(`[${requestId}] Connection error: ${apiError.code}`);
          return res.status(400).json({ 
            error: 'Unable to connect to Eleven Labs service. Please check your internet connection.' 
          });
        } else {
          console.log(`[${requestId}] Unexpected error: ${apiError.message}`);
          return res.status(400).json({ 
            error: `Audio generation failed: ${apiError.message}` 
          });
        }
      }
      
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`[${requestId}] General error after ${totalTime}ms:`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      res.status(400).json({ 
        error: `Preview generation failed: ${error.message}`,
        requestId
      });
    }
  });

  // Serve cached preview audio
  router.get('/recordings/preview/cache/:cacheKey', async (req, res) => {
    try {
      const { cacheKey } = req.params;
      
      if (!previewCache.has(cacheKey)) {
        return res.status(404).json({ error: 'Preview not found or expired' });
      }
      
      const cached = previewCache.get(cacheKey);
      
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Content-Length', cached.audioData.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(cached.audioData);
      
    } catch (error) {
      console.error('Error serving cached preview:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Stream recording audio directly from Eleven Labs
  router.get('/recordings/:id/stream', authenticateToken, async (req, res) => {
    try {
      const recording = await recordingService.getRecording(
        req.params.id,
        req.user.tenantId
      );
      
      if (!recording.text) {
        return res.status(400).json({ error: 'Recording has no text for streaming' });
      }
      
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      if (!config.apiKey) {
        return res.status(400).json({ error: 'Eleven Labs API key not configured' });
      }
      
      const voiceId = recording.elevenLabsVoiceId || config.defaultVoiceId;
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Accept-Ranges', 'bytes');
      
      const response = await axios({
        method: 'POST',
        url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
        headers: {
          'xi-api-key': config.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        data: {
          text: recording.text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: getValidVoiceSettings(config)
        },
        responseType: 'stream'
      });
      
      response.data.pipe(res);
      
      // Track usage
      recordingService.trackUsage(recording.id, req.user.tenantId, {
        context: 'audio_stream',
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
      
    } catch (error) {
      console.error('Error streaming audio:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== SSH/ASTERISK INTEGRATION =====

  // Deploy to Asterisk server
  router.post('/recordings/:id/deploy-to-asterisk', authenticateToken, async (req, res) => {
    try {
      const result = await recordingService.deployToAsterisk(
        req.params.id,
        req.user.tenantId
      );
      res.json(result);
    } catch (error) {
      console.error('Error deploying to Asterisk:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Test SSH connection
  router.post('/recordings/test-asterisk-ssh', authenticateToken, async (req, res) => {
    try {
      const result = await recordingService.testAsteriskConnection();
      res.json(result);
    } catch (error) {
      console.error('Error testing SSH connection:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // List remote recordings
  router.get('/recordings/asterisk/list', authenticateToken, async (req, res) => {
    try {
      const recordings = await recordingService.listRemoteRecordings(req.user.tenantId);
      res.json({ recordings });
    } catch (error) {
      console.error('Error listing remote recordings:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Setup remote server
  router.post('/recordings/asterisk/setup', authenticateToken, async (req, res) => {
    try {
      const result = await recordingService.setupRemoteServer();
      res.json(result);
    } catch (error) {
      console.error('Error setting up remote server:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get Asterisk playback path
  router.get('/recordings/:id/asterisk-path', authenticateToken, async (req, res) => {
    try {
      const recording = await recordingService.getRecording(
        req.params.id,
        req.user.tenantId
      );
      
      if (recording.asteriskStatus !== 'deployed') {
        return res.status(400).json({ error: 'Recording not deployed to Asterisk' });
      }
      
      const asteriskPath = recordingService.getAsteriskPlaybackPath(recording);
      
      res.json({
        asteriskPath,
        fullPath: recording.remoteFilePath,
        deployedAt: recording.asteriskDeployedAt,
        status: recording.asteriskStatus
      });
    } catch (error) {
      console.error('Error getting Asterisk path:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== ANALYTICS & USAGE TRACKING =====

  // Get recording analytics
  router.get('/recordings/:id/analytics', authenticateToken, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      const analytics = await recordingService.getRecordingAnalytics(
        req.params.id,
        req.user.tenantId,
        { startDate, endDate }
      );
      
      res.json(analytics);
    } catch (error) {
      console.error('Error getting recording analytics:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get recording usage history
  router.get('/recordings/:id/usage', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      
      const usage = await recordingModels.RecordingUsageLog.findAll({
        where: {
          recordingId: req.params.id,
          tenantId: req.user.tenantId
        },
        order: [['usedAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });
      
      const count = await recordingModels.RecordingUsageLog.count({
        where: {
          recordingId: req.params.id,
          tenantId: req.user.tenantId
        }
      });
      
      res.json({
        usage,
        totalCount: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / parseInt(limit))
      });
    } catch (error) {
      console.error('Error getting recording usage:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Track recording usage
  router.post('/recordings/:id/track-usage', authenticateToken, async (req, res) => {
    try {
      await recordingService.trackUsage(
        req.params.id,
        req.user.tenantId,
        req.body
      );
      res.json({ message: 'Usage tracked successfully' });
    } catch (error) {
      console.error('Error tracking usage:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== RECORDING TEMPLATES =====
  
  // List recording templates
  router.get('/recording-templates', authenticateToken, async (req, res) => {
    try {
      const { category, isActive = true, page = 1, limit = 50 } = req.query;
      
      const where = { tenantId: req.user.tenantId };
      if (category) where.category = category;
      if (isActive !== undefined) where.isActive = isActive === 'true';
      
      const result = await recordingModels.RecordingTemplate.findAndCountAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });
      
      res.json({
        templates: result.rows,
        totalCount: result.count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(result.count / parseInt(limit))
      });
    } catch (error) {
      console.error('Error listing recording templates:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get recording template
  router.get('/recording-templates/:id', authenticateToken, async (req, res) => {
    try {
      const template = await recordingModels.RecordingTemplate.findOne({
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId
        }
      });
      
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      
      res.json(template);
    } catch (error) {
      console.error('Error getting recording template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Create recording template
  router.post('/recording-templates', authenticateToken, async (req, res) => {
    try {
      const template = await recordingService.createTemplate(
        req.user.tenantId,
        req.body
      );
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating recording template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Update recording template
  router.put('/recording-templates/:id', authenticateToken, async (req, res) => {
    try {
      const [updated] = await recordingModels.RecordingTemplate.update(req.body, {
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId
        }
      });
      
      if (!updated) {
        return res.status(404).json({ error: 'Template not found' });
      }
      
      const template = await recordingModels.RecordingTemplate.findByPk(req.params.id);
      res.json(template);
    } catch (error) {
      console.error('Error updating recording template:', error);
      res.status(400).json({ error: error.message });
    }
  });
  
  // Delete recording template
  router.delete('/recording-templates/:id', authenticateToken, async (req, res) => {
    try {
      const result = await recordingModels.RecordingTemplate.destroy({
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId
        }
      });
      
      if (!result) {
        return res.status(404).json({ error: 'Template not found' });
      }
      
      res.json({ message: 'Template deleted successfully' });
    } catch (error) {
      console.error('Error deleting recording template:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Generate recording from template
  router.post('/recording-templates/:id/generate', authenticateToken, async (req, res) => {
    try {
      const { name, variables, voiceId } = req.body;
      
      const recording = await recordingService.generateFromTemplate(
        req.params.id,
        req.user.tenantId,
        variables,
        { name, voiceId }
      );
      
      res.status(201).json(recording);
    } catch (error) {
      console.error('Error generating recording from template:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== CONFIGURATION =====

  // Get Eleven Labs configuration
  router.get('/recordings/config/elevenlabs', authenticateToken, async (req, res) => {
    try {
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      // Hide API key for security
      const safeConfig = { ...config.toJSON() };
      if (safeConfig.apiKey) {
        safeConfig.apiKey = '***HIDDEN***';
      }
      
      res.json(safeConfig);
    } catch (error) {
      console.error('Error getting Eleven Labs config:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Update Eleven Labs configuration
  router.put('/recordings/config/elevenlabs', authenticateToken, async (req, res) => {
    try {
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      // Ensure voice settings are properly structured
      if (req.body.voiceSettings) {
        req.body.voiceSettings = {
          stability: parseFloat(req.body.voiceSettings.stability) || 0.5,
          similarity_boost: parseFloat(req.body.voiceSettings.similarity_boost) || 0.8,
          ...req.body.voiceSettings
        };
      }
      
      await config.update(req.body);
      
      // Hide API key for security
      const safeConfig = { ...config.toJSON() };
      if (safeConfig.apiKey) {
        safeConfig.apiKey = '***HIDDEN***';
      }
      
      res.json(safeConfig);
    } catch (error) {
      console.error('Error updating Eleven Labs config:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // ===== ELEVEN LABS ENHANCED FEATURES =====

  // Test API connection
  router.post('/recordings/config/elevenlabs/test-connection', authenticateToken, async (req, res) => {
    try {
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      if (!config.apiKey) {
        return res.status(400).json({ 
          success: false,
          error: 'Eleven Labs API key not configured' 
        });
      }

      if (config.apiKey === '***HIDDEN***') {
        return res.status(400).json({ 
          success: false,
          error: 'Please configure a valid Eleven Labs API key' 
        });
      }

      const startTime = Date.now();
      
      try {
        // Test API connection by getting voice list
        const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
          headers: {
            'xi-api-key': config.apiKey
          },
          timeout: 10000,
          validateStatus: function (status) {
            return status >= 200 && status < 300;
          }
        });

        const responseTime = Date.now() - startTime;

        // Get subscription info
        let subscriptionInfo = null;
        try {
          const subResponse = await axios.get('https://api.elevenlabs.io/v1/user/subscription', {
            headers: {
              'xi-api-key': config.apiKey
            },
            timeout: 5000,
            validateStatus: function (status) {
              return status >= 200 && status < 300;
            }
          });
          subscriptionInfo = subResponse.data;
        } catch (subError) {
          console.log('Could not fetch subscription info:', subError.message);
        }

        res.json({
          success: true,
          message: 'Eleven Labs API connection successful',
          apiKeyValid: true,
          subscriptionActive: subscriptionInfo ? subscriptionInfo.status === 'active' : true,
          characterQuota: {
            remaining: subscriptionInfo ? subscriptionInfo.character_limit - subscriptionInfo.character_count : config.monthlyCharacterLimit - config.charactersUsedThisMonth,
            total: subscriptionInfo ? subscriptionInfo.character_limit : config.monthlyCharacterLimit
          },
          voicesAvailable: response.data.voices ? response.data.voices.length : 0,
          responseTime
        });

      } catch (apiError) {
        console.error('Eleven Labs API error:', apiError);
        
        const responseTime = Date.now() - startTime;
        
        if (apiError.response) {
          const status = apiError.response.status;
          
          switch (status) {
            case 401:
              return res.status(400).json({
                success: false,
                apiKeyValid: false,
                error: 'Invalid API key',
                responseTime
              });
            case 403:
              return res.status(400).json({
                success: false,
                apiKeyValid: true,
                error: 'API access denied - check subscription status',
                responseTime
              });
            case 429:
              return res.status(400).json({
                success: false,
                apiKeyValid: true,
                error: 'Rate limit exceeded',
                responseTime
              });
            case 500:
              return res.status(400).json({
                success: false,
                apiKeyValid: true,
                error: 'Eleven Labs service temporarily unavailable',
                responseTime
              });
            default:
              return res.status(400).json({
                success: false,
                apiKeyValid: status !== 401,
                error: `API error (${status}): ${apiError.response.statusText}`,
                responseTime
              });
          }
        } else if (apiError.code === 'ECONNABORTED') {
          return res.status(400).json({
            success: false,
            apiKeyValid: true,
            error: 'Connection timeout - Eleven Labs service is slow to respond',
            responseTime: null
          });
        } else if (apiError.code === 'ENOTFOUND' || apiError.code === 'ECONNREFUSED') {
          return res.status(400).json({
            success: false,
            apiKeyValid: true,
            error: 'Unable to connect to Eleven Labs service',
            responseTime: null
          });
        } else {
          return res.status(400).json({
            success: false,
            apiKeyValid: true,
            error: apiError.message,
            responseTime: null
          });
        }
      }

    } catch (error) {
      console.error('Error testing Eleven Labs connection:', error);
      res.status(400).json({
        success: false,
        apiKeyValid: false,
        error: error.message,
        responseTime: null
      });
    }
  });

  // Get available voices
  router.get('/recordings/config/elevenlabs/voices', authenticateToken, async (req, res) => {
    try {
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      if (!config.apiKey) {
        return res.status(400).json({ error: 'Eleven Labs API key not configured' });
      }

      if (config.apiKey === '***HIDDEN***') {
        return res.status(400).json({ error: 'Please configure a valid Eleven Labs API key' });
      }

      try {
        const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
          headers: {
            'xi-api-key': config.apiKey
          },
          timeout: 10000,
          validateStatus: function (status) {
            return status >= 200 && status < 300;
          }
        });

        const voices = response.data.voices || [];

        res.json({
          voices: voices.map(voice => ({
            voice_id: voice.voice_id,
            name: voice.name,
            category: voice.category,
            description: voice.labels?.description || 'No description available',
            preview_url: voice.preview_url,
            labels: voice.labels
          })),
          totalCount: voices.length,
          defaultVoiceId: config.defaultVoiceId
        });

      } catch (apiError) {
        console.error('Error getting voices from Eleven Labs:', apiError);
        
        if (apiError.response) {
          const status = apiError.response.status;
          
          switch (status) {
            case 401:
              return res.status(400).json({ error: 'Invalid Eleven Labs API key' });
            case 403:
              return res.status(400).json({ error: 'API access denied - check subscription status' });
            case 429:
              return res.status(400).json({ error: 'Rate limit exceeded - please wait before trying again' });
            case 500:
              return res.status(400).json({ error: 'Eleven Labs service temporarily unavailable' });
            default:
              return res.status(400).json({ error: `API error (${status}): ${apiError.response.statusText}` });
          }
        } else if (apiError.code === 'ECONNABORTED') {
          return res.status(400).json({ error: 'Request timeout - Eleven Labs service is slow to respond' });
        } else if (apiError.code === 'ENOTFOUND' || apiError.code === 'ECONNREFUSED') {
          return res.status(400).json({ error: 'Unable to connect to Eleven Labs service' });
        } else {
          return res.status(400).json({ error: apiError.message });
        }
      }

    } catch (error) {
      console.error('Error getting voices:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get specific voice details
  router.get('/recordings/config/elevenlabs/voices/:voiceId', authenticateToken, async (req, res) => {
    try {
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      if (!config.apiKey) {
        return res.status(400).json({ error: 'Eleven Labs API key not configured' });
      }

      if (config.apiKey === '***HIDDEN***') {
        return res.status(400).json({ error: 'Please configure a valid Eleven Labs API key' });
      }

      try {
        const response = await axios.get(`https://api.elevenlabs.io/v1/voices/${req.params.voiceId}`, {
          headers: {
            'xi-api-key': config.apiKey
          },
          timeout: 10000,
          validateStatus: function (status) {
            return status >= 200 && status < 300;
          }
        });

        res.json(response.data);

      } catch (apiError) {
        console.error('Error getting voice details:', apiError);
        
        if (apiError.response) {
          const status = apiError.response.status;
          
          switch (status) {
            case 401:
              return res.status(401).json({ error: 'Invalid Eleven Labs API key' });
            case 404:
              return res.status(404).json({ error: 'Voice not found' });
            case 403:
              return res.status(400).json({ error: 'API access denied - check subscription status' });
            case 429:
              return res.status(400).json({ error: 'Rate limit exceeded' });
            default:
              return res.status(400).json({ error: `API error (${status}): ${apiError.response.statusText}` });
          }
        } else {
          return res.status(400).json({ error: apiError.message });
        }
      }

    } catch (error) {
      console.error('Error getting voice details:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Test voice with sample text - FIXED VERSION
  router.post('/recordings/config/elevenlabs/test-voice', authenticateToken, async (req, res) => {
    try {
      const { voiceId, text = 'Hello, this is a test of this voice.' } = req.body;
      
      if (!voiceId) {
        return res.status(400).json({ error: 'Voice ID is required' });
      }

      if (text.length > 100) {
        return res.status(400).json({ error: 'Test text limited to 100 characters' });
      }

      // Validate text using our helper function
      const validation = validateTextForTTS(text);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: validation.errors[0],
          allErrors: validation.errors
        });
      }

      const cleanText = validation.cleanText;

      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      if (!config.apiKey) {
        return res.status(400).json({ error: 'Eleven Labs API key not configured' });
      }

      if (config.apiKey === '***HIDDEN***') {
        return res.status(400).json({ error: 'Please configure a valid Eleven Labs API key' });
      }

      // Generate cache key for test
      const cacheKey = crypto.createHash('md5')
        .update(`test_voice:${req.user.tenantId}:${voiceId}:${cleanText}`)
        .digest('hex');

      console.log(`Testing voice ${voiceId} with text: "${cleanText}"`);

      try {
        const response = await axios.post(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            text: cleanText,
            model_id: 'eleven_monolingual_v1',
            voice_settings: getValidVoiceSettings(config)
          },
          {
            headers: {
              'xi-api-key': config.apiKey,
              'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer',
            timeout: 30000,
            validateStatus: function (status) {
              return status >= 200 && status < 300;
            }
          }
        );

        // Validate that we received audio data
        if (!response.data || response.data.byteLength === 0) {
          throw new Error('No audio data received from Eleven Labs');
        }
        
        // Check if response is actually HTML (error page) instead of audio
        const responseText = new TextDecoder().decode(response.data.slice(0, 100));
        if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
          throw new Error('Invalid API response - received HTML instead of audio data');
        }

        // Cache the test audio
        previewCache.set(cacheKey, {
          audioData: response.data,
          timestamp: Date.now(),
          contentType: 'audio/mpeg'
        });

        res.json({
          success: true,
          audioUrl: `/api/recordings/preview/cache/${cacheKey}`,
          voiceId,
          text: cleanText,
          charactersUsed: cleanText.length,
          message: 'Voice test successful'
        });

      } catch (apiError) {
        console.error('Eleven Labs API error:', apiError);
        
        if (apiError.response) {
          const status = apiError.response.status;
          
          // Try to get the actual error message from the response
          let errorDetail = '';
          try {
            if (apiError.response.data) {
              const errorData = Buffer.isBuffer(apiError.response.data) 
                ? JSON.parse(apiError.response.data.toString()) 
                : apiError.response.data;
              
              if (errorData.detail) {
                errorDetail = Array.isArray(errorData.detail) 
                  ? errorData.detail.map(d => d.msg || d.message || d).join(', ')
                  : errorData.detail;
              }
            }
          } catch (parseError) {
            console.log('Could not parse error details:', parseError.message);
          }
          
          switch (status) {
            case 401:
              return res.status(400).json({ 
                success: false,
                error: 'Invalid Eleven Labs API key' 
              });
            case 404:
              return res.status(400).json({ 
                success: false,
                error: 'Voice not found' 
              });
            case 422:
              const detailedError = errorDetail 
                ? `Invalid request: ${errorDetail}` 
                : 'Invalid text for speech synthesis. Please use readable text with proper words and punctuation.';
              return res.status(400).json({ 
                success: false,
                error: detailedError
              });
            case 429:
              return res.status(400).json({ 
                success: false,
                error: 'Rate limit exceeded' 
              });
            default:
              return res.status(400).json({ 
                success: false,
                error: `API error (${status}): ${errorDetail || apiError.response.statusText}` 
              });
          }
        } else {
          return res.status(400).json({ 
            success: false,
            error: apiError.message 
          });
        }
      }

    } catch (error) {
      console.error('Error testing voice:', error);
      res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }
  });

  // Get detailed usage analytics
  router.get('/recordings/config/elevenlabs/usage', authenticateToken, async (req, res) => {
    try {
      const { period = 'month' } = req.query;
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);

      let startDate, endDate;
      const now = new Date();

      switch (period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          endDate = now;
          break;
        case 'month':
        default:
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = now;
          break;
      }

      // Get usage from recordings and previews
      const recordings = await recordingModels.Recording.findAll({
        where: {
          tenantId: req.user.tenantId,
          generatedAt: {
            [Op.between]: [startDate, endDate]
          },
          text: { [Op.ne]: null }
        },
        attributes: ['id', 'name', 'text', 'generatedAt', 'elevenLabsVoiceId'],
        order: [['generatedAt', 'DESC']]
      });

      // Calculate usage statistics
      const totalCharacters = recordings.reduce((sum, rec) => sum + (rec.text?.length || 0), 0);
      const averageDaily = period === 'month' ? totalCharacters / now.getDate() : totalCharacters;
      
      const remainingCharacters = config.monthlyCharacterLimit - config.charactersUsedThisMonth;
      const usagePercentage = (config.charactersUsedThisMonth / config.monthlyCharacterLimit) * 100;

      // Calculate days until reset (assuming monthly reset on 1st)
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const daysUntilReset = Math.ceil((nextReset - now) / (1000 * 60 * 60 * 24));

      // Projected usage
      const projectedMonthlyUsage = averageDaily * 30;
      const willExceedLimit = projectedMonthlyUsage > config.monthlyCharacterLimit;

      // Daily breakdown
      const dailyUsage = {};
      recordings.forEach(rec => {
        const date = rec.generatedAt.toISOString().split('T')[0];
        if (!dailyUsage[date]) {
          dailyUsage[date] = { characters: 0, recordings: 0 };
        }
        dailyUsage[date].characters += rec.text?.length || 0;
        dailyUsage[date].recordings += 1;
      });

      const usage = Object.entries(dailyUsage).map(([date, data]) => ({
        date,
        ...data
      })).sort((a, b) => new Date(b.date) - new Date(a.date));

      res.json({
        period,
        charactersUsed: config.charactersUsedThisMonth,
        charactersLimit: config.monthlyCharacterLimit,
        charactersRemaining: remainingCharacters,
        usagePercentage: Math.round(usagePercentage * 100) / 100,
        resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0],
        daysUntilReset,
        dailyAverage: Math.round(averageDaily * 100) / 100,
        projectedMonthlyUsage: Math.round(projectedMonthlyUsage),
        willExceedLimit,
        usage: usage.slice(0, 30) // Last 30 days
      });

    } catch (error) {
      console.error('Error getting usage analytics:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get generation history
  router.get('/recordings/config/elevenlabs/history', authenticateToken, async (req, res) => {
    try {
      const { limit = 50, page = 1 } = req.query;

      // Get recordings with generation history
      const recordings = await recordingModels.Recording.findAll({
        where: {
          tenantId: req.user.tenantId,
          generatedAt: { [Op.ne]: null },
          text: { [Op.ne]: null }
        },
        attributes: ['id', 'name', 'text', 'elevenLabsVoiceId', 'generatedAt'],
        order: [['generatedAt', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit)
      });

      const totalCount = await recordingModels.Recording.count({
        where: {
          tenantId: req.user.tenantId,
          generatedAt: { [Op.ne]: null },
          text: { [Op.ne]: null }
        }
      });

      // Get voice names (cached for performance)
      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      let voiceNames = {};
      
      if (config.apiKey) {
        try {
          const voicesResponse = await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': config.apiKey },
            timeout: 5000
          });
          voiceNames = voicesResponse.data.voices.reduce((acc, voice) => {
            acc[voice.voice_id] = voice.name;
            return acc;
          }, {});
        } catch (error) {
          console.log('Could not fetch voice names for history');
        }
      }

      const history = recordings.map(rec => ({
        id: rec.id,
        recordingId: rec.id,
        recordingName: rec.name,
        text: rec.text.length > 100 ? rec.text.substring(0, 100) + '...' : rec.text,
        voiceId: rec.elevenLabsVoiceId,
        voiceName: voiceNames[rec.elevenLabsVoiceId] || 'Unknown Voice',
        charactersUsed: rec.text.length,
        generatedAt: rec.generatedAt,
        type: 'recording'
      }));

      res.json({
        history,
        totalCount,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit))
      });

    } catch (error) {
      console.error('Error getting generation history:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Batch generate multiple recordings
  router.post('/recordings/config/elevenlabs/batch-generate', authenticateToken, async (req, res) => {
    try {
      const { recordings } = req.body;

      if (!recordings || !Array.isArray(recordings) || recordings.length === 0) {
        return res.status(400).json({ error: 'Recordings array is required' });
      }

      if (recordings.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 recordings per batch' });
      }

      const batchId = `batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      console.log(`Starting batch generation ${batchId} for ${recordings.length} recordings`);

      const results = {
        batchId,
        totalRecordings: recordings.length,
        successful: 0,
        failed: 0,
        estimatedCharacters: 0,
        actualCharacters: 0,
        status: 'processing',
        results: []
      };

      // Estimate characters first
      for (const reqRec of recordings) {
        try {
          const recording = await recordingService.getRecording(reqRec.recordingId, req.user.tenantId);
          results.estimatedCharacters += recording.text?.length || 0;
        } catch (error) {
          // Skip estimation errors
        }
      }

      // Process each recording
      for (const reqRec of recordings) {
        try {
          const recording = await recordingService.getRecording(reqRec.recordingId, req.user.tenantId);
          
          // Update voice if specified
          if (reqRec.voiceId && reqRec.voiceId !== recording.elevenLabsVoiceId) {
            await recording.update({ elevenLabsVoiceId: reqRec.voiceId });
          }

          // Generate audio
          const generatedRecording = await recordingService.generateAudio(
            reqRec.recordingId,
            req.user.tenantId
          );

          results.successful++;
          results.actualCharacters += recording.text?.length || 0;
          results.results.push({
            recordingId: reqRec.recordingId,
            status: 'completed',
            charactersUsed: recording.text?.length || 0,
            fileName: generatedRecording.fileName,
            generatedAt: generatedRecording.generatedAt
          });

        } catch (error) {
          results.failed++;
          results.results.push({
            recordingId: reqRec.recordingId,
            status: 'failed',
            error: error.message
          });

          console.error(`Batch generation failed for recording ${reqRec.recordingId}:`, error.message);
        }
      }

      results.status = results.failed === 0 ? 'completed' : 'partial';

      res.json(results);

    } catch (error) {
      console.error('Error in batch generation:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Validate voice ID
  router.post('/recordings/config/elevenlabs/validate-voice', authenticateToken, async (req, res) => {
    try {
      const { voiceId } = req.body;

      if (!voiceId) {
        return res.status(400).json({ 
          valid: false,
          error: 'Voice ID is required' 
        });
      }

      const config = await recordingService.getElevenLabsConfig(req.user.tenantId);
      
      if (!config.apiKey) {
        return res.status(400).json({ 
          valid: false,
          error: 'Eleven Labs API key not configured' 
        });
      }

      if (config.apiKey === '***HIDDEN***') {
        return res.status(400).json({ 
          valid: false,
          error: 'Please configure a valid Eleven Labs API key' 
        });
      }

      try {
        // Check if voice exists
        const response = await axios.get(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
          headers: {
            'xi-api-key': config.apiKey
          },
          timeout: 10000,
          validateStatus: function (status) {
            return status >= 200 && status < 300;
          }
        });

        res.json({
          valid: true,
          voice: {
            voice_id: response.data.voice_id,
            name: response.data.name,
            category: response.data.category
          },
          message: 'Voice ID is valid'
        });

      } catch (apiError) {
        console.error('Error validating voice:', apiError);

        if (apiError.response) {
          const status = apiError.response.status;
          
          switch (status) {
            case 401:
              return res.json({
                valid: false,
                error: 'Invalid Eleven Labs API key'
              });
            case 404:
              return res.json({
                valid: false,
                error: 'Voice not found'
              });
            case 403:
              return res.json({
                valid: false,
                error: 'API access denied - check subscription status'
              });
            case 429:
              return res.json({
                valid: false,
                error: 'Rate limit exceeded'
              });
            default:
              return res.json({
                valid: false,
                error: `API error (${status}): ${apiError.response.statusText}`
              });
          }
        } else {
          return res.json({
            valid: false,
            error: apiError.message
          });
        }
      }

    } catch (error) {
      console.error('Error validating voice:', error);
      res.status(400).json({
        valid: false,
        error: error.message
      });
    }
  });

  // Serve recording files (fallback for local files)
  app.use('/recordings', express.static(path.join(__dirname, '../recordings')));
  
  // Register routes
  app.use('/api', router);
  
  return recordingModels;
};