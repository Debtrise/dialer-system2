// sales-rep-photo-routes.js
// Routes for managing sales rep photos and fallback configuration
// ENHANCED with database type compatibility for categories column

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { Readable } = require('stream');
const csv = require('csv-parser');
const axios = require('axios');
const bcrypt = require('bcrypt');

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

/**
 * Helper function to safely query categories with fallback for different column types
 */
function getSalesRepCategoriesWhere(sequelize) {
  try {
    // Try array-based query first (for properly configured databases)
    return {
      categories: {
        [sequelize.Sequelize.Op.overlap]: ['Sales Reps']
      }
    };
  } catch (error) {
    console.warn('⚠️ Array-based categories query not supported, using string fallback');
    // Fallback for VARCHAR-type categories column
    return sequelize.literal(`LOWER(categories::text) LIKE '%sales rep%' OR LOWER(categories::text) LIKE '%sales_rep%'`);
  }
}

/**
 * Enhanced find function with database type compatibility using raw SQL
 */
async function findSalesRepAsset(ContentAsset, sequelize, whereConditions) {
  const tenantId = whereConditions.tenantId;
  let emailCondition = '';
  let replacements = {};
  
  // Handle email condition properly
  if (whereConditions[sequelize.Sequelize.Op.and]) {
    const literalCondition = whereConditions[sequelize.Sequelize.Op.and][0];
    if (literalCondition && literalCondition.val) {
      emailCondition = `AND ${literalCondition.val}`;
      replacements = whereConditions.replacements || {};
    }
  }
  
  const rawQuery = `
    SELECT * FROM content_assets 
    WHERE (
      (categories @> ARRAY['Sales Reps']::text[] OR categories @> ARRAY['sales_reps']::text[])
      OR 
      (LOWER(categories::text) LIKE '%sales rep%' OR LOWER(categories::text) LIKE '%sales_rep%')
    )
    AND tenant_id = $1
    ${emailCondition}
    ORDER BY created_at DESC 
    LIMIT 1
  `;
  
  try {
    const [results] = await sequelize.query(rawQuery, {
      bind: [tenantId],
      replacements: replacements,
      type: sequelize.QueryTypes.SELECT
    });
    
    if (results && results.length > 0) {
      // Convert raw result back to model instance
      return await ContentAsset.findByPk(results[0].id);
    }
    return null;
  } catch (error) {
    console.error('❌ Error in findSalesRepAsset:', error.message);
    // Fallback to simple text search only
    const fallbackQuery = `
      SELECT * FROM content_assets 
      WHERE LOWER(categories::text) LIKE '%sales rep%'
      AND tenant_id = $1
      ${emailCondition}
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    try {
      const [fallbackResults] = await sequelize.query(fallbackQuery, {
        bind: [tenantId],
        replacements: replacements,
        type: sequelize.QueryTypes.SELECT
      });
      
      if (fallbackResults && fallbackResults.length > 0) {
        return await ContentAsset.findByPk(fallbackResults[0].id);
      }
    } catch (fallbackError) {
      console.error('❌ Fallback query also failed:', fallbackError.message);
    }
    return null;
  }
}

/**
 * Enhanced findAll function with database type compatibility using raw SQL
 */
async function findAllSalesRepAssets(ContentAsset, sequelize, whereConditions, options = {}) {
  const { limit = 50, offset = 0 } = options;
  const tenantId = whereConditions.tenantId;
  
  const rawQuery = `
    SELECT * FROM content_assets 
    WHERE (
      (categories @> ARRAY['Sales Reps']::text[] OR categories @> ARRAY['sales_reps']::text[])
      OR 
      (LOWER(categories::text) LIKE '%sales rep%' OR LOWER(categories::text) LIKE '%sales_rep%')
    )
    AND tenant_id = $1
    ORDER BY created_at DESC 
    LIMIT $2 OFFSET $3
  `;
  
  try {
    const [results] = await sequelize.query(rawQuery, {
      bind: [tenantId, limit, offset],
      type: sequelize.QueryTypes.SELECT
    });
    
    if (results && results.length > 0) {
      // Convert raw results back to model instances
      const ids = results.map(r => r.id);
      return await ContentAsset.findAll({
        where: { id: { [sequelize.Sequelize.Op.in]: ids } },
        order: [['createdAt', 'DESC']]
      });
    }
    return [];
  } catch (error) {
    console.error('❌ Error in findAllSalesRepAssets:', error.message);
    // Fallback to simple text search only
    const fallbackQuery = `
      SELECT * FROM content_assets 
      WHERE LOWER(categories::text) LIKE '%sales rep%'
      AND tenant_id = $1
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `;
    
    try {
      const [fallbackResults] = await sequelize.query(fallbackQuery, {
        bind: [tenantId, limit, offset],
        type: sequelize.QueryTypes.SELECT
      });
      
      if (fallbackResults && fallbackResults.length > 0) {
        const ids = fallbackResults.map(r => r.id);
        return await ContentAsset.findAll({
          where: { id: { [sequelize.Sequelize.Op.in]: ids } },
          order: [['createdAt', 'DESC']]
        });
      }
    } catch (fallbackError) {
      console.error('❌ Fallback findAll also failed:', fallbackError.message);
    }
    return [];
  }
}

/**
 * Enhanced count function with database type compatibility using raw SQL
 */
async function countSalesRepAssets(ContentAsset, sequelize, whereConditions) {
  const tenantId = whereConditions.tenantId;
  
  const rawQuery = `
    SELECT COUNT(*) as count FROM content_assets 
    WHERE (
      (categories @> ARRAY['Sales Reps']::text[] OR categories @> ARRAY['sales_reps']::text[])
      OR 
      (LOWER(categories::text) LIKE '%sales rep%' OR LOWER(categories::text) LIKE '%sales_rep%')
    )
    AND tenant_id = $1
  `;
  
  try {
    const [results] = await sequelize.query(rawQuery, {
      bind: [tenantId],
      type: sequelize.QueryTypes.SELECT
    });
    
    return parseInt(results[0]?.count) || 0;
  } catch (error) {
    console.error('❌ Error in countSalesRepAssets:', error.message);
    // Fallback to simple text search only
    const fallbackQuery = `
      SELECT COUNT(*) as count FROM content_assets 
      WHERE LOWER(categories::text) LIKE '%sales rep%'
      AND tenant_id = $1
    `;
    
    try {
      const [fallbackResults] = await sequelize.query(fallbackQuery, {
        bind: [tenantId],
        type: sequelize.QueryTypes.SELECT
      });
      
      return parseInt(fallbackResults[0]?.count) || 0;
    } catch (fallbackError) {
      console.error('❌ Fallback count also failed:', fallbackError.message);
      return 0;
    }
  }
}

module.exports = function(app, sequelize, authenticateToken, contentService) {
  const router = express.Router();
  const { ContentAsset } = sequelize.models;

  router.post('/sales-rep-photos/upload', authenticateToken, upload.single('photo'), async (req, res) => {
    try {
      const { repEmail, repName } = req.body;
      const normalizedEmail = repEmail.toLowerCase().trim();
      
      console.log('📧 Received request:', { repEmail: normalizedEmail, repName, hasFile: !!req.file });
      
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

      // Check if photo already exists for this email - ENHANCED with compatibility
      console.log('🔍 Checking for existing photo for email:', normalizedEmail);
      const existingAsset = await findSalesRepAsset(ContentAsset, sequelize, {
        tenantId: req.user.tenantId,
        [sequelize.Sequelize.Op.and]: [
          sequelize.literal(`metadata->>'repEmail' = :repEmail`)
        ]
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
        name: `Sales Rep Photo - ${repName || normalizedEmail}`,
        tags: ['sales-rep', 'profile', 'photo'],
        categories: ['Sales Reps'],
        metadata: {
          repEmail: normalizedEmail,
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

  // Bulk upload with thumbnails - ENHANCED with compatibility
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
            name: `Sales Rep Photo - ${mapping.name || mapping.email.toLowerCase()}`,
            tags: ['sales-rep', 'profile', 'photo'],
            categories: ['Sales Reps'],
            metadata: {
              repEmail: mapping.email.toLowerCase(),
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

  // Bulk create sales reps from CSV with photo download - ENHANCED with compatibility
  router.post('/sales-rep-photos/bulk-csv', authenticateToken, upload.single('csv'), async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin role required.' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'CSV file is required' });
      }

      const User = sequelize.models.User;
      const rows = [];
      await new Promise((resolve, reject) => {
        Readable.from(req.file.buffer)
          .pipe(csv())
          .on('data', data => rows.push(data))
          .on('end', resolve)
          .on('error', reject);
      });

      const results = [];
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2;

        const name = (row.name || row.Name || row.repName || '').toString().trim();
        const email = (row.email || row.Email || row.repEmail || '').toString().trim().toLowerCase();
        const photoUrl = (row.photo || row.photoUrl || row.photo_url || row.Photo || '').toString().trim();

        if (!email) {
          errors.push({ row: rowNumber, error: 'Missing email' });
          continue;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          errors.push({ row: rowNumber, email, error: 'Invalid email' });
          continue;
        }

        const existing = await User.findOne({ where: { email, tenantId: req.user.tenantId } });
        if (existing) {
          errors.push({ row: rowNumber, email, error: 'User already exists' });
          continue;
        }

        let usernameBase = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
        if (usernameBase.length === 0) usernameBase = 'user';
        let username = usernameBase;
        let counter = 1;
        while (await User.findOne({ where: { username } })) {
          username = `${usernameBase}${counter++}`;
        }

        const passwordPlain = Math.random().toString(36).slice(-8);
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(passwordPlain, salt);

        let firstName = '';
        let lastName = '';
        if (name) {
          const parts = name.split(' ');
          firstName = parts.shift();
          lastName = parts.join(' ');
        }

        const user = await User.create({
          username,
          password: hashedPassword,
          email,
          tenantId: req.user.tenantId,
          role: 'agent',
          firstName,
          lastName,
          isActive: true,
          createdBy: req.user.id
        });

        let assetInfo = null;
        if (photoUrl) {
          try {
            const response = await axios.get(photoUrl, { responseType: 'arraybuffer', timeout: 15000 });
            const file = {
              buffer: Buffer.from(response.data),
              originalname: path.basename(photoUrl.split('?')[0] || 'photo.jpg'),
              mimetype: response.headers['content-type'] || 'image/jpeg',
              size: response.data.length
            };
            const metadata = {
              name: `Sales Rep Photo - ${name || email}`,
              tags: ['sales-rep', 'profile', 'photo'],
              categories: ['Sales Reps'],
              metadata: {
                repEmail: email,
                repName: name || null,
                uploadedBy: req.user.email || req.user.username,
                originalUrl: photoUrl,
                uploadedAt: new Date().toISOString()
              }
            };
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
                const namePart = path.basename(url);
                const src = path.join(contentService.directories.previews, namePart);
                const dest = path.join(repPreviewDir, namePart);
                await fs.copyFile(src, dest);
                newPreviews[size] = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-previews/${namePart}`;
              }

              await asset.update({ thumbnailUrl: asset.thumbnailUrl, previewUrls: newPreviews });
            } catch (thumbErr) {
              console.warn('⚠️ Failed to persist sales rep thumbnails:', thumbErr.message);
            }

            assetInfo = { id: asset.id, url: asset.publicUrl, thumbnailUrl: asset.thumbnailUrl };
          } catch (err) {
            errors.push({ row: rowNumber, email, error: `Photo download failed: ${err.message}` });
          }
        }

        results.push({ row: rowNumber, email, username, password: passwordPlain, userId: user.id, asset: assetInfo });
      }

      res.json({ created: results.length, failed: errors.length, results, errors });

    } catch (error) {
      console.error('Error in CSV bulk upload:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Set fallback photo with thumbnails - ENHANCED with compatibility
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

  // Get current fallback photo - ENHANCED with compatibility
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

  // Get sales rep photo by email - ENHANCED with compatibility
  router.get('/sales-rep-photos/by-email/:email', authenticateToken, async (req, res) => {
    try {
      const email = req.params.email.toLowerCase();
      console.log('🔍 Looking for photo for email:', email);
      
      const asset = await findSalesRepAsset(ContentAsset, sequelize, {
        tenantId: req.user.tenantId,
        [sequelize.Sequelize.Op.and]: [
          sequelize.literal(`metadata->>'repEmail' = :repEmail`)
        ]
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

  // List all sales rep photos - ENHANCED with compatibility
  router.get('/sales-rep-photos', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      
      const assets = await findAllSalesRepAssets(ContentAsset, sequelize, {
        tenantId: req.user.tenantId
      }, {
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        order: [['createdAt', 'DESC']]
      });

      const count = await countSalesRepAssets(ContentAsset, sequelize, {
        tenantId: req.user.tenantId
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

  // Generate celebration video for a sales rep - ENHANCED with compatibility
  router.post('/sales-rep-photos/generate-video', authenticateToken, async (req, res) => {
    try {
      const { repEmail, repName, dealAmount, companyName } = req.body;
      const normalizedEmail = repEmail.toLowerCase().trim();

      if (!repEmail) {
        return res.status(400).json({ error: 'repEmail is required' });
      }

      const asset = await findSalesRepAsset(ContentAsset, sequelize, {
        tenantId: req.user.tenantId,
        [sequelize.Sequelize.Op.and]: [
          sequelize.literal(`metadata->>'repEmail' = :repEmail`)
        ]
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

  // Delete sales rep photo - ENHANCED with compatibility
  router.delete('/sales-rep-photos/:id', authenticateToken, async (req, res) => {
    try {
      const asset = await findSalesRepAsset(ContentAsset, sequelize, {
        id: req.params.id,
        tenantId: req.user.tenantId
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
  
  console.log('✅ Sales rep photo routes registered successfully with database compatibility');
};