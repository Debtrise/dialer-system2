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
const { Op } = require('sequelize');

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

      (categories::varchar[] @> ARRAY['Sales Reps']::varchar[] OR categories::varchar[] @> ARRAY['sales_reps']::varchar[])

      (categories::text[] @> ARRAY['Sales Reps']::text[] OR categories::text[] @> ARRAY['sales_reps']::text[])

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
  const { limit = 50, offset = 0, search = '' } = options;
  const tenantId = whereConditions.tenantId;

  const rawQuery = `
    SELECT * FROM content_assets
    WHERE (
      (categories::text[] @> ARRAY['Sales Reps']::text[] OR categories::text[] @> ARRAY['sales_reps']::text[])
      OR
      (LOWER(categories::text) LIKE '%sales rep%' OR LOWER(categories::text) LIKE '%sales_rep%')
    )
    AND tenant_id = $1
    AND ($4 = '' OR
      LOWER(metadata->>'repEmail') LIKE $4 OR
      LOWER(metadata->>'rep_email') LIKE $4 OR
      LOWER(metadata->>'email') LIKE $4 OR
      LOWER(metadata->>'repName') LIKE $4 OR
      LOWER(name) LIKE $4
    )
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `;
  
  try {
    const searchParam = `%${search.toLowerCase()}%`;
    const [results] = await sequelize.query(rawQuery, {
      bind: [tenantId, limit, offset, searchParam],
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
        AND ($4 = '' OR
             LOWER(metadata->>'repEmail') LIKE $4 OR
             LOWER(metadata->>'rep_email') LIKE $4 OR
             LOWER(metadata->>'email') LIKE $4 OR
             LOWER(metadata->>'repName') LIKE $4 OR
             LOWER(name) LIKE $4 )
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;

      const [fallbackResults] = await sequelize.query(fallbackQuery, {
        bind: [tenantId, limit, offset, searchParam],
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
async function countSalesRepAssets(ContentAsset, sequelize, whereConditions, options = {}) {
  const { search = '' } = options;
  const tenantId = whereConditions.tenantId;
  
  const rawQuery = `
    SELECT COUNT(*) as count FROM content_assets 
    WHERE (
      (categories::text[] @> ARRAY['Sales Reps']::text[] OR categories::text[] @> ARRAY['sales_reps']::text[])
      OR 
      (LOWER(categories::text) LIKE '%sales rep%' OR LOWER(categories::text) LIKE '%sales_rep%')
    )
    AND tenant_id = $1
    AND ($2 = '' OR
      LOWER(metadata->>'repEmail') LIKE $2 OR
      LOWER(metadata->>'rep_email') LIKE $2 OR
      LOWER(metadata->>'email') LIKE $2 OR
      LOWER(metadata->>'repName') LIKE $2 OR
      LOWER(name) LIKE $2
    )
  `;

  const searchParam = `%${search.toLowerCase()}%`;

  try {
    const [results] = await sequelize.query(rawQuery, {
      bind: [tenantId, searchParam],
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
      AND ($2 = '' OR
        LOWER(metadata->>'repEmail') LIKE $2 OR
        LOWER(metadata->>'rep_email') LIKE $2 OR
        LOWER(metadata->>'email') LIKE $2 OR
        LOWER(metadata->>'repName') LIKE $2 OR
        LOWER(name) LIKE $2
      )
    `;
    
    try {
      const [fallbackResults] = await sequelize.query(fallbackQuery, {
        bind: [tenantId, searchParam],
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
// shared/sales-rep-photo-routes.js - Fixed upload handling

// Upload single sales rep photo with enhanced error handling
router.post('/sales-rep-photos/upload', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No photo file uploaded' });
    }

    const repEmail = (req.body.repEmail || '').toLowerCase().trim();
    const repName = req.body.repName || '';

    if (!repEmail) {
      return res.status(400).json({ error: 'Rep email is required' });
    }

    console.log(`📸 Processing sales rep photo upload:`, {
      repEmail,
      repName,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Validate file type
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'File must be an image' });
    }

    // Validate file size (10MB limit for photos)
    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image too large. Maximum size is 10MB.' });
    }

    // Check for existing photo
    const normalizedEmail = repEmail.toLowerCase().trim();
    const existingAsset = await ContentAsset.findOne({
      where: {
        tenantId: req.user.tenantId,
        [Op.or]: [
          sequelize.where(
            sequelize.fn('LOWER', sequelize.json('metadata.repEmail')),
            normalizedEmail
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.json('metadata.rep_email')),
            normalizedEmail
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.json('metadata.email')),
            normalizedEmail
          )
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
      try {
        await existingAsset.destroy();
      } catch (deleteError) {
        console.warn('⚠️ Failed to delete existing asset:', deleteError.message);
      }
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
    
    let asset;
    try {
      // Use ContentCreationService to get thumbnails and previews automatically
      asset = await contentService.uploadAsset(
        req.user.tenantId,
        req.user.id,
        req.file,
        metadata
      );
    } catch (uploadError) {
      console.error('❌ Content service upload failed:', uploadError.message);
      
      // Fallback: Create basic asset record without processing
      try {
        const timestamp = Date.now();
        const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fallbackFilename = `fallback_${timestamp}_${safeFilename}`;
        const fallbackPath = path.join(process.cwd(), 'uploads', 'content', 'assets', fallbackFilename);
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(fallbackPath), { recursive: true });
        
        // Save file
        await fs.writeFile(fallbackPath, req.file.buffer);
        
        // Create asset record
        asset = await ContentAsset.create({
          tenantId: req.user.tenantId,
          name: metadata.name,
          filename: fallbackFilename,
          filePath: fallbackPath,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          assetType: 'image',
          publicUrl: `${req.protocol}://${req.get('host')}/uploads/content/assets/${fallbackFilename}`,
          thumbnailUrl: null,
          previewUrls: {},
          uploadedBy: req.user.id,
          tags: metadata.tags,
          categories: metadata.categories,
          metadata: metadata.metadata,
          processingStatus: 'failed_processed_manually'
        });
        
        console.log('✅ Created fallback asset record');
      } catch (fallbackError) {
        console.error('❌ Fallback asset creation also failed:', fallbackError.message);
        return res.status(500).json({ 
          error: 'Failed to upload photo: ' + uploadError.message,
          fallbackError: fallbackError.message
        });
      }
    }

    // Copy to specialized directories (if processing was successful)
    try {
      if (asset.thumbnailUrl && asset.previewUrls) {
        const repPhotoDir = contentService.directories.salesRepPhotos;
        const repThumbDir = contentService.directories.salesRepThumbnails;
        const repPreviewDir = contentService.directories.salesRepPreviews;
        
        await fs.mkdir(repPhotoDir, { recursive: true });
        await fs.mkdir(repThumbDir, { recursive: true });
        await fs.mkdir(repPreviewDir, { recursive: true });

        // Copy original
        if (asset.filePath) {
          const origName = path.basename(asset.filePath);
          const origDest = path.join(repPhotoDir, origName);
          try {
            await fs.copyFile(asset.filePath, origDest);
          } catch (copyError) {
            console.warn('⚠️ Failed to copy original to rep photos dir:', copyError.message);
          }
        }

        // Copy thumbnail
        if (asset.thumbnailUrl) {
          const thumbName = path.basename(asset.thumbnailUrl);
          const thumbSrc = path.join(contentService.directories.thumbnails, thumbName);
          const thumbDest = path.join(repThumbDir, thumbName);
          try {
            await fs.copyFile(thumbSrc, thumbDest);
            asset.thumbnailUrl = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-thumbnails/${thumbName}`;
          } catch (copyError) {
            console.warn('⚠️ Failed to copy thumbnail:', copyError.message);
          }
        }

        // Copy previews
        const newPreviews = {};
        for (const [size, url] of Object.entries(asset.previewUrls || {})) {
          const previewName = path.basename(url);
          const previewSrc = path.join(contentService.directories.previews, previewName);
          const previewDest = path.join(repPreviewDir, previewName);
          try {
            await fs.copyFile(previewSrc, previewDest);
            newPreviews[size] = `${req.protocol}://${req.get('host')}/uploads/content/sales-rep-previews/${previewName}`;
          } catch (copyError) {
            console.warn(`⚠️ Failed to copy ${size} preview:`, copyError.message);
            newPreviews[size] = url; // Keep original URL
          }
        }

        // Update asset with new URLs
        if (Object.keys(newPreviews).length > 0) {
          try {
            await asset.update({ 
              thumbnailUrl: asset.thumbnailUrl,
              previewUrls: newPreviews 
            });
          } catch (updateError) {
            console.warn('⚠️ Failed to update asset URLs:', updateError.message);
          }
        }
      }
    } catch (dirError) {
      console.warn('⚠️ Failed to copy to specialized directories:', dirError.message);
    }

    console.log('✅ Sales rep photo upload completed:', {
      id: asset.id,
      repEmail: normalizedEmail,
      repName: repName,
      hasProcessing: !!asset.thumbnailUrl
    });

    res.json({
      message: 'Sales rep photo uploaded successfully',
      asset: {
        id: asset.id,
        name: asset.name,
        url: asset.publicUrl,
        thumbnailUrl: asset.thumbnailUrl,
        previewUrls: asset.previewUrls,
        repEmail: normalizedEmail,
        repName: repName,
        processed: asset.processingStatus !== 'failed_processed_manually'
      }
    });

  } catch (error) {
    console.error('❌ Sales rep photo upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload sales rep photo: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Enhanced bulk upload with better error handling
router.post('/sales-rep-photos/bulk-csv', authenticateToken, csvUpload.single('csv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    console.log('📊 Processing bulk CSV upload:', {
      filename: req.file.originalname,
      size: req.file.size
    });

    const rows = await parseCsvBuffer(req.file.buffer);
    const successes = [];
    const failures = [];

    console.log(`📋 Processing ${rows.length} rows from CSV`);

    for (const [index, row] of rows.entries()) {
      const email = (row.email || row.repEmail || row.rep_email || '').toLowerCase().trim();
      const name = row.name || row.repName || row.rep_name || '';
      const photoUrl = row.photoUrl || row.photo_url || row.url || '';

      console.log(`📝 Processing row ${index + 1}:`, { email, name, photoUrl: photoUrl.substring(0, 50) + '...' });

      if (!email || !photoUrl) {
        failures.push({ 
          row: index + 1, 
          email, 
          error: 'Missing email or photoUrl' 
        });
        continue;
      }

      try {
        // Download image with timeout and better error handling
        console.log(`🌐 Downloading image for ${email}...`);
        
        const response = await axios.get(photoUrl, { 
          responseType: 'arraybuffer', 
          timeout: 30000, // 30 second timeout
          maxContentLength: 10 * 1024 * 1024, // 10MB limit
          headers: {
            'User-Agent': 'Knittt-Sales-Rep-Photo-Uploader/1.0'
          }
        });

        if (!response.data || response.data.length === 0) {
          throw new Error('Downloaded file is empty');
        }

        // Validate content type
        const contentType = response.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
          throw new Error(`Invalid content type: ${contentType}`);
        }

        // Create file object
        const file = {
          originalname: path.basename(new URL(photoUrl).pathname) || `photo_${email}.jpg`,
          mimetype: contentType,
          buffer: Buffer.from(response.data),
          size: response.data.length
        };

        console.log(`📸 Processing image for ${email}:`, {
          size: file.size,
          type: file.mimetype
        });

        // Prepare metadata
        const metadata = {
          name: `Sales Rep Photo - ${name || email}`,
          tags: ['sales-rep', 'profile', 'photo', 'bulk-upload'],
          categories: ['Sales Reps'],
          metadata: {
            repEmail: email,
            repName: name || null,
            uploadedBy: req.user.email || req.user.username,
            originalUrl: photoUrl,
            uploadedAt: new Date().toISOString(),
            bulkUpload: true
          }
        };

        // Upload using content service
        let asset;
        try {
          asset = await contentService.uploadAsset(
            req.user.tenantId,
            req.user.id,
            file,
            metadata
          );
        } catch (uploadError) {
          console.warn(`⚠️ Content service upload failed for ${email}, trying fallback:`, uploadError.message);
          
          // Fallback upload
          const timestamp = Date.now();
          const safeFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
          const fallbackFilename = `bulk_fallback_${timestamp}_${safeFilename}`;
          const fallbackPath = path.join(process.cwd(), 'uploads', 'content', 'assets', fallbackFilename);
          
          await fs.mkdir(path.dirname(fallbackPath), { recursive: true });
          await fs.writeFile(fallbackPath, file.buffer);
          
          asset = await ContentAsset.create({
            tenantId: req.user.tenantId,
            name: metadata.name,
            filename: fallbackFilename,
            filePath: fallbackPath,
            fileSize: file.size,
            mimeType: file.mimetype,
            assetType: 'image',
            publicUrl: `${req.protocol}://${req.get('host')}/uploads/content/assets/${fallbackFilename}`,
            thumbnailUrl: null,
            previewUrls: {},
            uploadedBy: req.user.id,
            tags: metadata.tags,
            categories: metadata.categories,
            metadata: metadata.metadata,
            processingStatus: 'fallback_upload'
          });
        }

        successes.push({ 
          row: index + 1,
          email, 
          name,
          assetId: asset.id,
          processed: asset.processingStatus !== 'fallback_upload'
        });

        console.log(`✅ Successfully processed ${email}`);

      } catch (err) {
        console.error(`❌ Failed to process ${email}:`, err.message);
        failures.push({ 
          row: index + 1,
          email, 
          error: err.message 
        });
      }
    }

    console.log(`📊 Bulk upload completed: ${successes.length} success, ${failures.length} failed`);

    res.json({ 
      message: `Bulk CSV upload processed: ${successes.length} successful, ${failures.length} failed`,
      successes, 
      failures,
      summary: {
        total: rows.length,
        successful: successes.length,
        failed: failures.length,
        successRate: rows.length > 0 ? Math.round((successes.length / rows.length) * 100) : 0
      }
    });
  } catch (error) {
    console.error('❌ Bulk CSV upload error:', error);
    res.status(500).json({ 
      error: 'Bulk upload failed: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
  // Get all sales rep photos - simplified query
 // Get all sales rep photos - simplified query
router.get('/sales-rep-photos', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const Op = sequelize.Sequelize.Op;
    
    const conditions = [
      sequelize.where(
        sequelize.cast(sequelize.col('categories'), 'text[]'),
        { [Op.overlap]: ['Sales Reps', 'sales_reps'] }
      )
    ];
    
    if (search) {
      const like = `%${search.toString().toLowerCase()}%`;
      conditions.push({
        [Op.or]: [
          { name: { [Op.iLike]: like } },
          sequelize.where(
            sequelize.fn('LOWER', sequelize.json('metadata.repEmail')),
            { [Op.like]: like }
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.json('metadata.rep_email')),
            { [Op.like]: like }
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.json('metadata.email')),
            { [Op.like]: like }
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.json('metadata.repName')),
            { [Op.like]: like }
          )
        ]
      });
    }
    
    const baseWhere = {
      tenantId: req.user.tenantId,
      [Op.and]: conditions
    };

    const { rows: assets, count: total } = await ContentAsset.findAndCountAll({
      where: baseWhere,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
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
      
      // Use overlap check so queries work across DB setups
      const asset = await ContentAsset.findOne({
        where: {
          tenantId: req.user.tenantId,
          [sequelize.Sequelize.Op.or]: [
            sequelize.where(sequelize.fn('LOWER', sequelize.json('metadata.repEmail')), email),
            sequelize.where(sequelize.fn('LOWER', sequelize.json('metadata.rep_email')), email),
            sequelize.where(sequelize.fn('LOWER', sequelize.json('metadata.email')), email)
          ],
          [sequelize.Sequelize.Op.and]: [
            sequelize.where(
              sequelize.cast(sequelize.col('categories'), 'text[]'),
              { [sequelize.Sequelize.Op.overlap]: ['Sales Reps', 'sales_reps'] }
            )
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

      const repPhotoDir = contentService.directories.salesRepPhotos;
      await fs.mkdir(repPhotoDir, { recursive: true });
      const origName = path.basename(asset.filePath);
      const origDest = path.join(repPhotoDir, origName);
      await fs.copyFile(asset.filePath, origDest);

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