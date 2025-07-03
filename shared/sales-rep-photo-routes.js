// sales-rep-photo-routes.js  
// FIXED VERSION - Resolves "Both replacements and bind cannot be set at the same time" error
// Routes for managing sales rep photos and fallback configuration

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

// Separate multer instance for CSV uploads
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const isCsv =
      file.mimetype === 'text/csv' ||
      path.extname(file.originalname).toLowerCase() === '.csv';
    if (isCsv) {
      return cb(null, true);
    }
    cb(new Error('Only CSV files are allowed'));
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
 * FIXED: Enhanced find function with database type compatibility using raw SQL
 * Resolves the "Both replacements and bind cannot be set at the same time" error
 */
async function findSalesRepAsset(ContentAsset, sequelize, whereConditions) {
  const tenantId = whereConditions.tenantId;
  
  // Build email condition from whereConditions - FIXED approach
  let emailValue = null;
  let emailCondition = '';
  
  // Extract email from whereConditions properly
  if (whereConditions[sequelize.Sequelize.Op.and]) {
    const andConditions = whereConditions[sequelize.Sequelize.Op.and];
    for (const condition of andConditions) {
      if (condition && condition.val && condition.val.includes('metadata->>')) {
        // Extract email value from literal condition
        const match = condition.val.match(/'([^']+)'/);
        if (match) {
          emailValue = match[1];
          emailCondition = `
            AND (
              LOWER(metadata->>'repEmail') = $2
              OR LOWER(metadata->>'rep_email') = $2
              OR LOWER(metadata->>'email') = $2
              OR LOWER(metadata->>'salesRepEmail') = $2
            )
          `;
          break;
        }
      }
    }
  }
  
  // FIXED: Use only bind parameters, no replacements
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
    // FIXED: Use only bind parameters
    const bindParams = emailValue ? [tenantId, emailValue] : [tenantId];
    
    const [results] = await sequelize.query(rawQuery, {
      bind: bindParams,
      type: sequelize.QueryTypes.SELECT
    });
    
    if (results && results.length > 0) {
      // Convert raw result back to model instance
      return await ContentAsset.findByPk(results[0].id);
    }
    return null;
    
  } catch (error) {
    console.error('❌ Error in findSalesRepAsset:', error.message);
    
    // FIXED: Fallback to simple text search only
    const fallbackQuery = `
      SELECT * FROM content_assets 
      WHERE LOWER(categories::text) LIKE '%sales rep%'
      AND tenant_id = $1
      ${emailCondition}
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    try {
      const bindParams = emailValue ? [tenantId, emailValue] : [tenantId];
      
      const [fallbackResults] = await sequelize.query(fallbackQuery, {
        bind: bindParams,
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
 * FIXED: Enhanced findAll function with database type compatibility using raw SQL
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

    let ids = [];
    if (results && results.length > 0) {
      ids = results.map(r => r.id);
    } else {
      // Fallback to simple text search when no results returned
      const fallbackQuery = `
        SELECT * FROM content_assets
        WHERE LOWER(categories::text) LIKE '%sales rep%'
        AND tenant_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;

      const [fallbackResults] = await sequelize.query(fallbackQuery, {
        bind: [tenantId, limit, offset],
        type: sequelize.QueryTypes.SELECT
      });

      if (fallbackResults && fallbackResults.length > 0) {
        ids = fallbackResults.map(r => r.id);
      }
    }

    if (ids.length > 0) {
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
 * FIXED: Enhanced count function with database type compatibility using raw SQL
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

// Parse CSV data from an uploaded buffer
function parseCsvBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
      .pipe(csv())
      .on('data', (data) => rows.push(data))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

module.exports = function(app, sequelize, authenticateToken, contentService) {
  const router = express.Router();
  const { ContentAsset } = sequelize.models;

  // Upload sales rep photo with FIXED error handling
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

      // FIXED: Check if photo already exists for this email - Enhanced with compatibility
      console.log('🔍 Checking for existing photo for email:', normalizedEmail);
      
      // Use a simpler approach to avoid the bind/replacements conflict
      const existingAsset = await ContentAsset.findOne({
        where: {
          tenantId: req.user.tenantId,
          [sequelize.Sequelize.Op.or]: [
            sequelize.literal(`metadata->>'repEmail' = '${normalizedEmail}'`),
            sequelize.literal(`metadata->>'rep_email' = '${normalizedEmail}'`),
            sequelize.literal(`metadata->>'email' = '${normalizedEmail}'`)
          ]
        }
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

      // Copy thumbnails to sales rep specific directories
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

        await asset.update({ 
          thumbnailUrl: asset.thumbnailUrl, 
          previewUrls: newPreviews 
        });

        console.log('✅ Asset uploaded with thumbnails:', {
          id: asset.id,
          thumbnailUrl: asset.thumbnailUrl,
          previewCount: Object.keys(newPreviews).length
        });

      } catch (thumbErr) {
        console.warn('⚠️ Failed to persist sales rep thumbnails:', thumbErr.message);
      }

      res.json({
        message: 'Sales rep photo uploaded successfully',
        asset: {
          id: asset.id,
          name: asset.name,
          url: asset.publicUrl,
          thumbnailUrl: asset.thumbnailUrl,
          previewUrls: asset.previewUrls,
          repEmail: normalizedEmail,
          repName: repName
        }
      });

    } catch (error) {
      console.error('Error uploading sales rep photo:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Bulk upload photos using a CSV with name,email,photoUrl columns
  router.post('/sales-rep-photos/bulk-csv', authenticateToken, csvUpload.single('csv'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'CSV file is required' });
      }

      const rows = await parseCsvBuffer(req.file.buffer);
      const successes = [];
      const failures = [];

      for (const row of rows) {
        const email = (row.email || row.repEmail || row.rep_email || '').toLowerCase().trim();
        const name = row.name || row.repName || row.rep_name || '';
        const photoUrl = row.photoUrl || row.photo_url || row.url || '';

        if (!email || !photoUrl) {
          failures.push({ row, error: 'Missing email or photoUrl' });
          continue;
        }

        try {
          const response = await axios.get(photoUrl, { responseType: 'arraybuffer', timeout: 15000 });
          const file = {
            originalname: path.basename(new URL(photoUrl).pathname || 'photo.jpg'),
            mimetype: response.headers['content-type'] || 'image/jpeg',
            buffer: Buffer.from(response.data),
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

          successes.push({ email, assetId: asset.id });
        } catch (err) {
          failures.push({ email, error: err.message });
        }
      }

      res.json({ message: 'Bulk CSV upload processed', successes, failures });
    } catch (error) {
      console.error('Error processing bulk CSV upload:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get all sales rep photos - ENHANCED with compatibility
  router.get('/sales-rep-photos', authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const assets = await findAllSalesRepAssets(ContentAsset, sequelize, {
        tenantId: req.user.tenantId
      }, {
        limit: parseInt(limit),
        offset
      });

      const total = await countSalesRepAssets(ContentAsset, sequelize, {
        tenantId: req.user.tenantId
      });

      const processedAssets = assets.map(asset => ({
        id: asset.id,
        name: asset.name,
        url: asset.publicUrl,
        thumbnailUrl: asset.thumbnailUrl,
        repEmail: asset.metadata?.repEmail,
        repName: asset.metadata?.repName,
        uploadedAt: asset.createdAt,
        fileSize: asset.fileSize
      }));

      res.json({
        assets: processedAssets,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalCount: total,
          hasNextPage: parseInt(page) * parseInt(limit) < total,
          hasPrevPage: parseInt(page) > 1
        }
      });

    } catch (error) {
      console.error('Error getting sales rep photos:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get sales rep photo by email - ENHANCED with compatibility
  router.get('/sales-rep-photos/by-email/:email', authenticateToken, async (req, res) => {
    try {
      const email = req.params.email.toLowerCase();
      console.log('🔍 Looking for photo for email:', email);
      
      // FIXED: Use simplified query to avoid bind/replacements conflict
      const asset = await ContentAsset.findOne({
        where: {
          tenantId: req.user.tenantId,
          [sequelize.Sequelize.Op.or]: [
            sequelize.literal(`metadata->>'repEmail' = '${email}'`),
            sequelize.literal(`metadata->>'rep_email' = '${email}'`),
            sequelize.literal(`metadata->>'email' = '${email}'`)
          ],
          [sequelize.Sequelize.Op.or]: [
            sequelize.literal(`categories::text LIKE '%Sales Rep%'`),
            sequelize.literal(`categories::text LIKE '%sales_rep%'`),
            sequelize.literal(`categories::text LIKE '%sales-rep%'`)
          ]
        }
      });

      if (!asset) {
        return res.status(404).json({ error: 'Photo not found for this sales rep' });
      }

      res.json({
        asset: {
          id: asset.id,
          name: asset.name,
          url: asset.publicUrl,
          thumbnailUrl: asset.thumbnailUrl,
          previewUrls: asset.previewUrls,
          repEmail: asset.metadata?.repEmail,
          repName: asset.metadata?.repName,
          uploadedAt: asset.createdAt
        }
      });

    } catch (error) {
      console.error('Error getting sales rep photo by email:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Generate a short celebration video using the rep photo
  router.post('/sales-rep-photos/generate-video', authenticateToken, async (req, res) => {
    try {
      const { repEmail, repName, dealAmount = '', companyName = '' } = req.body;
      if (!repEmail) {
        return res.status(400).json({ error: 'repEmail is required' });
      }
      const email = repEmail.toLowerCase();
      const asset = await ContentAsset.findOne({
        where: {
          tenantId: req.user.tenantId,
          [sequelize.Sequelize.Op.or]: [
            sequelize.literal(`metadata->>'repEmail' = '${email}'`),
            sequelize.literal(`metadata->>'rep_email' = '${email}'`),
            sequelize.literal(`metadata->>'email' = '${email}'`)
          ]
        }
      });

      if (!asset) {
        return res.status(404).json({ error: 'Photo not found for this sales rep' });
      }

      const video = await contentService.generateCelebrationVideo({
        repName: repName || asset.metadata?.repName || email,
        repPhotoUrl: asset.publicUrl,
        dealAmount,
        companyName
      });

      res.json({
        message: 'Video generated successfully',
        videoUrl: video.publicUrl
      });
    } catch (error) {
      console.error('Error generating celebration video:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Set fallback photo - ENHANCED with compatibility
  router.post('/sales-rep-photos/fallback', authenticateToken, upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Photo file is required' });
      }

      // Prepare metadata for fallback photo
      const metadata = {
        name: 'Sales Rep Fallback Photo',
        tags: ['sales-rep', 'fallback', 'default'],
        categories: ['Sales Reps', 'Fallback'],
        metadata: {
          isFallbackPhoto: true,
          uploadedBy: req.user.email || req.user.username,
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
          [sequelize.Sequelize.Op.and]: [
            sequelize.literal(`metadata->>'isFallbackPhoto' = 'true'`)
          ]
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

  // Delete sales rep photo - ENHANCED with compatibility
  router.delete('/sales-rep-photos/:id', authenticateToken, async (req, res) => {
    try {
      const asset = await ContentAsset.findOne({
        where: {
          id: req.params.id,
          tenantId: req.user.tenantId
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
  
  console.log('✅ Sales rep photo routes registered successfully with FIXED database compatibility');
};