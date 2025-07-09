// scripts/migrate-webhook-announcements.js
// Migration script to convert webhook announcements from projectId to templateId

const { Sequelize } = require('sequelize');

/**
 * Migration script to update webhook announcements from project-based to template-based
 */
async function migrateWebhookAnnouncements(sequelize) {
  console.log('🚀 Starting webhook announcement migration...');
  console.log('📋 Converting from projectId to templateId configuration');
  
  const transaction = await sequelize.transaction();
  
  try {
    const migrationStats = {
      totalWebhooks: 0,
      announcementWebhooks: 0,
      migrated: 0,
      alreadyMigrated: 0,
      failed: 0,
      errors: []
    };
    
    // Step 1: Find all announcement webhooks
    const [webhooks] = await sequelize.query(`
      SELECT 
        id, 
        name, 
        tenant_id,
        announcement_config
      FROM webhook_endpoints 
      WHERE webhook_type = 'announcement' 
        AND is_active = true
        AND announcement_config IS NOT NULL
        AND announcement_config::jsonb @> '{"enabled": true}'::jsonb
    `, { transaction });
    
    migrationStats.totalWebhooks = webhooks.length;
    console.log(`📊 Found ${webhooks.length} announcement webhooks to analyze`);
    
    // Step 2: Process each webhook
    for (const webhook of webhooks) {
      try {
        const config = webhook.announcement_config;
        const contentCreator = config.contentCreator || {};
        
        migrationStats.announcementWebhooks++;
        
        // Check if already migrated
        if (contentCreator.templateId && !contentCreator.projectId) {
          console.log(`✅ Webhook "${webhook.name}" already uses templateId`);
          migrationStats.alreadyMigrated++;
          continue;
        }
        
        // Check if needs migration
        if (!contentCreator.projectId) {
          console.log(`⚠️ Webhook "${webhook.name}" has no projectId - skipping`);
          migrationStats.failed++;
          migrationStats.errors.push({
            webhookId: webhook.id,
            webhookName: webhook.name,
            error: 'No projectId found in configuration'
          });
          continue;
        }
        
        console.log(`🔄 Migrating webhook "${webhook.name}" (${webhook.id})`);
        console.log(`   📁 Current projectId: ${contentCreator.projectId}`);
        
        // Step 3: Find the project and its template
        const [projects] = await sequelize.query(`
          SELECT 
            id,
            name,
            template_id,
            metadata
          FROM content_projects 
          WHERE id = :projectId
        `, {
          replacements: { projectId: contentCreator.projectId },
          transaction
        });
        
        if (projects.length === 0) {
          console.log(`❌ Project ${contentCreator.projectId} not found for webhook "${webhook.name}"`);
          migrationStats.failed++;
          migrationStats.errors.push({
            webhookId: webhook.id,
            webhookName: webhook.name,
            error: `Project ${contentCreator.projectId} not found`
          });
          continue;
        }
        
        const project = projects[0];
        
        if (!project.template_id) {
          console.log(`❌ Project ${project.id} has no templateId for webhook "${webhook.name}"`);
          migrationStats.failed++;
          migrationStats.errors.push({
            webhookId: webhook.id,
            webhookName: webhook.name,
            error: `Project ${project.id} has no template_id`
          });
          continue;
        }
        
        // Step 4: Get template information
        const [templates] = await sequelize.query(`
          SELECT 
            id,
            name,
            category,
            description
          FROM content_templates 
          WHERE id = :templateId
        `, {
          replacements: { templateId: project.template_id },
          transaction
        });
        
        if (templates.length === 0) {
          console.log(`❌ Template ${project.template_id} not found for webhook "${webhook.name}"`);
          migrationStats.failed++;
          migrationStats.errors.push({
            webhookId: webhook.id,
            webhookName: webhook.name,
            error: `Template ${project.template_id} not found`
          });
          continue;
        }
        
        const template = templates[0];
        
        console.log(`   📋 Found template: ${template.name} (${template.id})`);
        
        // Step 5: Update the webhook configuration
        const updatedConfig = {
          ...config,
          contentCreator: {
            ...contentCreator,
            templateId: template.id,
            templateName: template.name,
            // Remove the old projectId
            projectId: undefined,
            // Add migration metadata
            migratedFrom: {
              projectId: contentCreator.projectId,
              projectName: project.name,
              migratedAt: new Date().toISOString()
            }
          }
        };
        
        // Remove undefined projectId
        delete updatedConfig.contentCreator.projectId;
        
        // Step 6: Update the database
        await sequelize.query(`
          UPDATE webhook_endpoints 
          SET announcement_config = :config
          WHERE id = :webhookId
        `, {
          replacements: {
            webhookId: webhook.id,
            config: JSON.stringify(updatedConfig)
          },
          transaction
        });
        
        console.log(`✅ Successfully migrated webhook "${webhook.name}"`);
        console.log(`   📋 Template: ${template.name} (${template.id})`);
        console.log(`   🔗 Original project: ${project.name} (${project.id})`);
        
        migrationStats.migrated++;
        
      } catch (error) {
        console.error(`❌ Error migrating webhook "${webhook.name}":`, error.message);
        migrationStats.failed++;
        migrationStats.errors.push({
          webhookId: webhook.id,
          webhookName: webhook.name,
          error: error.message
        });
      }
    }
    
    // Step 7: Commit transaction
    await transaction.commit();
    
    // Step 8: Print migration summary
    console.log('\n📊 Migration Summary:');
    console.log(`   Total webhooks analyzed: ${migrationStats.totalWebhooks}`);
    console.log(`   Announcement webhooks: ${migrationStats.announcementWebhooks}`);
    console.log(`   Successfully migrated: ${migrationStats.migrated}`);
    console.log(`   Already migrated: ${migrationStats.alreadyMigrated}`);
    console.log(`   Failed: ${migrationStats.failed}`);
    
    if (migrationStats.errors.length > 0) {
      console.log('\n❌ Migration Errors:');
      migrationStats.errors.forEach(error => {
        console.log(`   - ${error.webhookName}: ${error.error}`);
      });
    }
    
    // Step 9: Verification query
    console.log('\n🔍 Running verification...');
    const [verificationResults] = await sequelize.query(`
      SELECT 
        COUNT(*) as total_announcement_webhooks,
        COUNT(CASE WHEN announcement_config::jsonb #> '{contentCreator,templateId}' IS NOT NULL THEN 1 END) as template_based,
        COUNT(CASE WHEN announcement_config::jsonb #> '{contentCreator,projectId}' IS NOT NULL THEN 1 END) as project_based
      FROM webhook_endpoints 
      WHERE webhook_type = 'announcement' 
        AND is_active = true
        AND announcement_config IS NOT NULL
        AND announcement_config::jsonb @> '{"enabled": true}'::jsonb
    `);
    
    const verification = verificationResults[0];
    console.log(`📊 Verification Results:`);
    console.log(`   Total announcement webhooks: ${verification.total_announcement_webhooks}`);
    console.log(`   Template-based: ${verification.template_based}`);
    console.log(`   Project-based (remaining): ${verification.project_based}`);
    
    if (verification.project_based > 0) {
      console.log(`⚠️ Warning: ${verification.project_based} webhooks still use projectId`);
    } else {
      console.log(`✅ All announcement webhooks successfully migrated to templates!`);
    }
    
    return migrationStats;
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Rollback migration (convert back to projectId)
 * Use this only if you need to revert the migration
 */
async function rollbackMigration(sequelize) {
  console.log('⚠️ Rolling back webhook announcement migration...');
  console.log('⚠️ This will restore projectId configuration from migration metadata');
  
  const transaction = await sequelize.transaction();
  
  try {
    const [webhooks] = await sequelize.query(`
      SELECT 
        id, 
        name, 
        announcement_config
      FROM webhook_endpoints 
      WHERE webhook_type = 'announcement' 
        AND announcement_config::jsonb #> '{contentCreator,migratedFrom}' IS NOT NULL
    `, { transaction });
    
    console.log(`Found ${webhooks.length} webhooks with migration metadata`);
    
    let rolledBack = 0;
    
    for (const webhook of webhooks) {
      try {
        const config = webhook.announcement_config;
        const migratedFrom = config.contentCreator.migratedFrom;
        
        if (migratedFrom && migratedFrom.projectId) {
          const restoredConfig = {
            ...config,
            contentCreator: {
              ...config.contentCreator,
              projectId: migratedFrom.projectId,
              // Remove template fields
              templateId: undefined,
              templateName: undefined,
              migratedFrom: undefined
            }
          };
          
          // Clean up undefined fields
          delete restoredConfig.contentCreator.templateId;
          delete restoredConfig.contentCreator.templateName;
          delete restoredConfig.contentCreator.migratedFrom;
          
          await sequelize.query(`
            UPDATE webhook_endpoints 
            SET announcement_config = :config
            WHERE id = :webhookId
          `, {
            replacements: {
              webhookId: webhook.id,
              config: JSON.stringify(restoredConfig)
            },
            transaction
          });
          
          console.log(`✅ Rolled back webhook "${webhook.name}" to project ${migratedFrom.projectId}`);
          rolledBack++;
        }
      } catch (error) {
        console.error(`❌ Error rolling back webhook "${webhook.name}":`, error.message);
      }
    }
    
    await transaction.commit();
    console.log(`✅ Rollback completed: ${rolledBack} webhooks restored`);
    
    return { rolledBack };
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}

module.exports = {
  migrateWebhookAnnouncements,
  rollbackMigration
};