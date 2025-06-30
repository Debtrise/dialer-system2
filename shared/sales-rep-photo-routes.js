// sales-rep-photo-routes.js
// Routes for managing sales rep photos and fallback configuration

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Configure multer for photo uploads - FIXED to use memoryStorage
const upload = multer({
  storage: multer.memoryStorage(), // This should provide file.buffer
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
    }
  }
});

module.exports = function(app, sequelize, authenticateToken, contentService) {
  const router = express.Router();
  const { ContentAsset } = sequelize.models;

  router.post('/sales-rep-photos/upload', authenticateToken, upload.single('photo'), async (req, res) => {
    try {
      const { repEmail, repName } = req.body;
      
      console.log('📧 Received request:', { repEmail, repName, hasFile: !!req.file });
      
      if (!repEmail) {
        return res.status(400).json({ error: 'Sales rep email is required' });
      }
      
      if (!req.file) {
        return res.status(400).json({ error: 'Photo file is required' });
      }

      console.log('📤 File debug info:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        hasBuffer: !!req.file.buffer
      });

      // Check if photo already exists for this email
      console.log('🔍 Checking for existing photo for email:', repEmail);
      const existingAsset = await ContentAsset.findOne({
        where: {
          tenantId: req.user.tenantId,
          categories: {
            [sequelize.Sequelize.Op.overlap]: ['Sales Reps']
          },
          [sequelize.Sequelize.Op.and]: [
            sequelize.literal(`metadata->>'repEmail' = :repEmail`)
          ]
        },
        replacements: { repEmail: repEmail }
      });

      if (existingAsset && !req.body.replace) {
        return res.status(409).json({ 
          error: 'Photo already exists for this sales rep. Set replace=true to update.' 
        });
      }

      // Delete existing asset if replacing
      if (existingAsset && req.body.replace) {
        console.log('🗑️ Deleting existing asset for replacement');
        await existingAsset.destroy();
      }

      // Prepare metadata for ContentCreationService
      const metadata = {
        name: `Sales Rep Photo - ${repName || repEmail}`,
        tags: ['sales-rep', 'profile', 'photo'],
        categories: ['Sales Reps'],
        metadata: {
          repEmail,
          repName: repName || null,
          uploadedBy: req.user.email || req.user.username,
          originalFilename: req.file.originalname,
          uploadedAt: new Date().toISOString()
        }
      };

      console.log('🚀 Using ContentCreationService for upload with image processing...');
      
      // Use ContentCreationService to get thumbnails and previews automatically
      const asset = await contentService.uploadAsset(
        req.user.tenantId,
        req.user.id,
        req.file,
        metadata
      );

      try {
        const thumbName = path.basename(asset.thumbnailUrl || '');
        const repThumbDir = contentService.directories.salesRepThumbnails;
        const repPreviewDir = contentService.directories.salesRepPreviews;
        await fs.mkdir(repThumbDir, { recursive: true });
        await fs.mkdir(repPreviewDir, { recursive: true });

        if (thumbName) {
          const src = path.join(contentService.directories.thumbnails, thumbName);
          const dest = path.join(repThumbDir, thumbName);
          await fs.copyFile(src, dest);
          asset.thumbnailUrl = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-thumbnails/${thumbName}`;
        }

        const newPreviews = {};
        for (const [size, url] of Object.entries(asset.previewUrls || {})) {
          const name = path.basename(url);
          const src = path.join(contentService.directories.previews, name);
          const dest = path.join(repPreviewDir, name);
          await fs.copyFile(src, dest);
          newPreviews[size] = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-previews/${name}`;
        }

        await asset.update({ thumbnailUrl: asset.thumbnailUrl, previewUrls: newPreviews });
      } catch (thumbErr) {
        console.warn('⚠️ Failed to persist sales rep thumbnails:', thumbErr.message);
      }

      // Persist thumbnails/previews in dedicated sales rep folders
      try {
        const thumbName = path.basename(asset.thumbnailUrl || '');
        const repThumbDir = contentService.directories.salesRepThumbnails;
        const repPreviewDir = contentService.directories.salesRepPreviews;
        await fs.mkdir(repThumbDir, { recursive: true });
        await fs.mkdir(repPreviewDir, { recursive: true });

        if (thumbName) {
          const src = path.join(contentService.directories.thumbnails, thumbName);
          const dest = path.join(repThumbDir, thumbName);
          await fs.copyFile(src, dest);
          asset.thumbnailUrl = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-thumbnails/${thumbName}`;
        }

        const newPreviews = {};
        for (const [size, url] of Object.entries(asset.previewUrls || {})) {
          const name = path.basename(url);
          const src = path.join(contentService.directories.previews, name);
          const dest = path.join(repPreviewDir, name);
          await fs.copyFile(src, dest);
          newPreviews[size] = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-previews/${name}`;
        }

        await asset.update({ thumbnailUrl: asset.thumbnailUrl, previewUrls: newPreviews });
      } catch (thumbErr) {
        console.warn('⚠️ Failed to persist sales rep thumbnails:', thumbErr.message);
      }

      console.log('✅ Asset uploaded with thumbnails:', {
        id: asset.id,
        thumbnailUrl: asset.thumbnailUrl,
        previewCount: Object.keys(asset.previewUrls || {}).length
      });

      res.json({
        message: 'Sales rep photo uploaded successfully',
        asset: {
          id: asset.id,
          url: asset.publicUrl,
          thumbnailUrl: asset.thumbnailUrl,
          previewUrls: asset.previewUrls,
          repEmail: asset.metadata.repEmail,
          repName: asset.metadata.repName,
          fileSize: asset.fileSize,
          mimeType: asset.mimeType,
          dimensions: asset.dimensions
        }
      });

    } catch (error) {
      console.error('❌ Error uploading sales rep photo:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Bulk upload with thumbnails
  router.post('/sales-rep-photos/bulk-upload', authenticateToken, upload.array('photos', 50), async (req, res) => {
    try {
      const { mappings } = req.body;
      
      if (!mappings) {
        return res.status(400).json({ error: 'Mappings are required (array of {filename, email, name})' });
      }

      const parsedMappings = JSON.parse(mappings);
      const results = [];
      const errors = [];

      for (const file of req.files) {
        const mapping = parsedMappings.find(m => m.filename === file.originalname);
        
        if (!mapping) {
          errors.push({
            filename: file.originalname,
            error: 'No mapping found for this file'
          });
          continue;
        }

        try {
          const metadata = {
            name: `Sales Rep Photo - ${mapping.name || mapping.email}`,
            tags: ['sales-rep', 'profile', 'photo'],
            categories: ['Sales Reps'],
            metadata: {
              repEmail: mapping.email,
              repName: mapping.name || null,
              uploadedBy: req.user.email || req.user.username,
              originalFilename: file.originalname,
              uploadedAt: new Date().toISOString()
            }
          };

          // Use ContentCreationService for each file
          const asset = await contentService.uploadAsset(
            req.user.tenantId,
            req.user.id,
            file,
            metadata
          );

          try {
            const thumbName = path.basename(asset.thumbnailUrl || '');
            const repThumbDir = contentService.directories.salesRepThumbnails;
            const repPreviewDir = contentService.directories.salesRepPreviews;
            await fs.mkdir(repThumbDir, { recursive: true });
            await fs.mkdir(repPreviewDir, { recursive: true });

            if (thumbName) {
              const src = path.join(contentService.directories.thumbnails, thumbName);
              const dest = path.join(repThumbDir, thumbName);
              await fs.copyFile(src, dest);
              asset.thumbnailUrl = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-thumbnails/${thumbName}`;
            }

            const newPreviews = {};
            for (const [size, url] of Object.entries(asset.previewUrls || {})) {
              const name = path.basename(url);
              const src = path.join(contentService.directories.previews, name);
              const dest = path.join(repPreviewDir, name);
              await fs.copyFile(src, dest);
              newPreviews[size] = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-previews/${name}`;
            }

            await asset.update({ thumbnailUrl: asset.thumbnailUrl, previewUrls: newPreviews });
          } catch (thumbErr) {
            console.warn('⚠️ Failed to persist sales rep thumbnails:', thumbErr.message);
          }

          results.push({
            filename: file.originalname,
            email: mapping.email,
            assetId: asset.id,
            url: asset.publicUrl,
            thumbnailUrl: asset.thumbnailUrl
          });

        } catch (error) {
          errors.push({
            filename: file.originalname,
            email: mapping.email,
            error: error.message
          });
        }
      }

      res.json({
        message: 'Bulk upload completed',
        successful: results.length,
        failed: errors.length,
        results,
        errors
      });

    } catch (error) {
      console.error('Error in bulk upload:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Set fallback photo with thumbnails
  router.post('/sales-rep-photos/fallback', authenticateToken, upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Photo file is required' });
      }

      // Remove existing fallback photo flag from other assets
      await ContentAsset.update(
        {
          metadata: sequelize.Sequelize.literal(`metadata - 'isFallbackPhoto'`)
        },
        {
          where: {
            tenantId: req.user.tenantId,
            [sequelize.Sequelize.Op.and]: [
              sequelize.literal(`metadata->>'isFallbackPhoto' = 'true'`)
            ]
          }
        }
      );

      // Create metadata for fallback photo
      const metadata = {
        name: 'Default Sales Rep Photo',
        tags: ['fallback', 'default', 'sales-rep', 'photo'],
        categories: ['Sales Reps', 'System'],
        metadata: {
          isFallbackPhoto: true,
          uploadedBy: req.user.email || req.user.username,
          originalFilename: req.file.originalname,
          uploadedAt: new Date().toISOString()
        }
      };

      // Use ContentCreationService to get thumbnails and previews
      const asset = await contentService.uploadAsset(
        req.user.tenantId,
        req.user.id,
        req.file,
        metadata
      );

      res.json({
        message: 'Fallback photo set successfully',
        asset: {
          id: asset.id,
          url: asset.publicUrl,
          thumbnailUrl: asset.thumbnailUrl,
          previewUrls: asset.previewUrls
        }
      });

    } catch (error) {
      console.error('Error setting fallback photo:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get current fallback photo
  router.get('/sales-rep-photos/fallback', authenticateToken, async (req, res) => {
    try {
      const asset = await ContentAsset.findOne({
        where: {
          tenantId: req.user.tenantId,
          metadata: {
            [sequelize.Sequelize.Op.jsonSupersetOf]: { isFallbackPhoto: true }
          }
        },
        order: [['createdAt', 'DESC']]
      });

      if (!asset) {
        return res.status(404).json({ error: 'Fallback photo not configured' });
      }

      res.json({
        id: asset.id,
        url: asset.publicUrl,
        thumbnailUrl: asset.thumbnailUrl
      });
    } catch (error) {
      console.error('Error retrieving fallback photo:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get sales rep photo by email - FIXED query
  router.get('/sales-rep-photos/by-email/:email', authenticateToken, async (req, res) => {
    try {
      console.log('🔍 Looking for photo for email:', req.params.email);
      
      const asset = await ContentAsset.findOne({
        where: {
          tenantId: req.user.tenantId,
          categories: {
            [sequelize.Sequelize.Op.overlap]: ['Sales Reps']
          },
          // Fixed metadata query
          [sequelize.Sequelize.Op.and]: [
            sequelize.literal(`metadata->>'repEmail' = :repEmail`)
          ]
        },
        replacements: { repEmail: req.params.email }
      });

      if (!asset) {
        return res.status(404).json({ error: 'Photo not found for this sales rep' });
      }

      res.json({
        id: asset.id,
        url: asset.publicUrl,
        thumbnailUrl: asset.thumbnailUrl,
        repEmail: asset.metadata.repEmail,
        repName: asset.metadata.repName,
        uploadedAt: asset.createdAt
      });

    } catch (error) {
      console.error('Error getting sales rep photo:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // List all sales rep photos - FIXED query
  router.get('/sales-rep-photos', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      
      const assets = await ContentAsset.findAll({
        where: {
          tenantId: req.user.tenantId,
          categories: {
            [sequelize.Sequelize.Op.overlap]: ['Sales Reps']
          }
        },
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [['createdAt', 'DESC']]
      });

      const count = await ContentAsset.count({
        where: {
          tenantId: req.user.tenantId,
          categories: {
            [sequelize.Sequelize.Op.overlap]: ['Sales Reps']
          }
        }
      });

      const photos = assets.map(asset => ({
        id: asset.id,
        url: asset.publicUrl,
        thumbnailUrl: asset.thumbnailUrl,
        repEmail: asset.metadata?.repEmail,
        repName: asset.metadata?.repName,
        uploadedAt: asset.createdAt,
        uploadedBy: asset.metadata?.uploadedBy
      }));

      res.json({
        photos,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
          totalCount: count
        }
      });

    } catch (error) {
      console.error('Error listing sales rep photos:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Generate celebration video for a sales rep
  router.post('/sales-rep-photos/generate-video', authenticateToken, async (req, res) => {
    try {
      const { repEmail, repName, dealAmount, companyName } = req.body;

      if (!repEmail) {
        return res.status(400).json({ error: 'repEmail is required' });
      }

      const asset = await ContentAsset.findOne({
        where: {
          tenantId: req.user.tenantId,
          categories: {
            [sequelize.Sequelize.Op.overlap]: ['Sales Reps']
          },
          [sequelize.Sequelize.Op.and]: [sequelize.literal(`metadata->>'repEmail' = :repEmail`)]
        },
        replacements: { repEmail }
      });

      if (!asset) {
        return res.status(404).json({ error: 'Photo not found for this sales rep' });
      }

      const videoInfo = await contentService.generateCelebrationVideo({
        repName: repName || asset.metadata?.repName || repEmail,
        repPhotoUrl: asset.publicUrl,
        dealAmount,
        companyName
      });

      res.json({ videoUrl: videoInfo.publicUrl });
    } catch (error) {
      console.error('Error generating celebration video:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Delete sales rep photo - FIXED query
  router.delete('/sales-rep-photos/:id', authenticateToken, async (req, res) => {
    try {
      const asset = await ContentAsset.findOne({
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId,
          categories: {
            [sequelize.Sequelize.Op.overlap]: ['Sales Reps']
          }
        }
      });

      if (!asset) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      // Delete the physical file
      try {
        await fs.unlink(asset.filePath);
        console.log('🗑️ Physical file deleted:', asset.filePath);
      } catch (fileError) {
        console.warn('⚠️ Could not delete physical file:', fileError.message);
      }

      const deletedEmail = asset.metadata?.repEmail;
      await asset.destroy();

      res.json({
        message: 'Sales rep photo deleted successfully',
        deletedEmail: deletedEmail
      });

    } catch (error) {
      console.error('Error deleting sales rep photo:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Register routes
  app.use('/api', router);
  
  console.log('✅ Sales rep photo routes registered successfully');
};