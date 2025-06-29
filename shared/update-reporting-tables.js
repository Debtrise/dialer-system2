// update-reporting-tables.js
// Run this script to update all reporting tables: node update-reporting-tables.js

const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: console.log
});

async function updateTables() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected successfully.');

    // Create/update ReportTemplates table
    console.log('\n1. Updating ReportTemplates table...');
    await sequelize.query(`
      DO $$ 
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ReportTemplates') THEN
              CREATE TABLE "ReportTemplates" (
                  "id" SERIAL PRIMARY KEY,
                  "tenantId" VARCHAR(255) NOT NULL,
                  "name" VARCHAR(255) NOT NULL,
                  "type" VARCHAR(255) CHECK ("type" IN ('call_summary', 'sms_summary', 'agent_performance', 'lead_conversion', 'journey_analytics', 'custom')) NOT NULL,
                  "config" JSONB DEFAULT '{}'::jsonb,
                  "schedule" JSONB DEFAULT '{"enabled":false,"frequency":"daily","time":"09:00","timezone":"America/Los_Angeles","format":"pdf","recipients":[]}'::jsonb,
                  "scheduleEnabled" BOOLEAN DEFAULT false,
                  "scheduleFrequency" VARCHAR(50) DEFAULT 'daily',
                  "scheduleTime" VARCHAR(5) DEFAULT '09:00',
                  "scheduleTimezone" VARCHAR(50) DEFAULT 'America/Los_Angeles',
                  "scheduleFormat" VARCHAR(10) DEFAULT 'pdf',
                  "isActive" BOOLEAN DEFAULT true,
                  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
              );
              CREATE INDEX "idx_report_templates_tenant_active" ON "ReportTemplates" ("tenantId", "isActive");
              CREATE INDEX "idx_report_templates_schedule" ON "ReportTemplates" ("scheduleEnabled", "scheduleTime") WHERE "scheduleEnabled" = true;
              RAISE NOTICE 'Table ReportTemplates created';
          ELSE
              ALTER TABLE "ReportTemplates" 
              ADD COLUMN IF NOT EXISTS "scheduleEnabled" BOOLEAN DEFAULT false,
              ADD COLUMN IF NOT EXISTS "scheduleFrequency" VARCHAR(50) DEFAULT 'daily',
              ADD COLUMN IF NOT EXISTS "scheduleTime" VARCHAR(5) DEFAULT '09:00',
              ADD COLUMN IF NOT EXISTS "scheduleTimezone" VARCHAR(50) DEFAULT 'America/Los_Angeles',
              ADD COLUMN IF NOT EXISTS "scheduleFormat" VARCHAR(10) DEFAULT 'pdf';
              
              UPDATE "ReportTemplates" 
              SET 
                "scheduleEnabled" = COALESCE(("schedule"->>'enabled')::boolean, false),
                "scheduleFrequency" = COALESCE("schedule"->>'frequency', 'daily'),
                "scheduleTime" = COALESCE("schedule"->>'time', '09:00'),
                "scheduleTimezone" = COALESCE("schedule"->>'timezone', 'America/Los_Angeles'),
                "scheduleFormat" = COALESCE("schedule"->>'format', 'pdf')
              WHERE "scheduleEnabled" IS NULL;
              RAISE NOTICE 'Table ReportTemplates updated';
          END IF;
      END $$;
    `);
    console.log('✓ ReportTemplates table updated');

    // Create DashboardSnapshots if missing
    console.log('\n2. Creating DashboardSnapshots table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "DashboardSnapshots" (
          "tenantId" VARCHAR(255) NOT NULL,
          "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL,
          "stats" JSONB NOT NULL DEFAULT '{"activeCalls":0,"waitingCalls":0,"availableAgents":0,"busyAgents":0,"todaysCalls":0,"todaysSms":0,"todaysLeads":0,"activeJourneys":0}'::jsonb,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("tenantId", "timestamp")
      );
    `);
    console.log('✓ DashboardSnapshots table created');

    // Create other reporting tables
    console.log('\n3. Creating other reporting tables...');
    
    // CallStatistics
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "CallStatistics" (
          "id" SERIAL PRIMARY KEY,
          "tenantId" VARCHAR(255) NOT NULL,
          "date" DATE NOT NULL,
          "hour" INTEGER,
          "totalCalls" INTEGER DEFAULT 0,
          "uniqueLeads" INTEGER DEFAULT 0,
          "answeredCalls" INTEGER DEFAULT 0,
          "missedCalls" INTEGER DEFAULT 0,
          "transferredCalls" INTEGER DEFAULT 0,
          "totalDuration" INTEGER DEFAULT 0,
          "avgDuration" FLOAT DEFAULT 0,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE("tenantId", "date", "hour")
      );
    `);
    console.log('✓ CallStatistics table created');

    // ReportExecutions
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "ReportExecutions" (
          "id" SERIAL PRIMARY KEY,
          "tenantId" VARCHAR(255) NOT NULL,
          "templateId" INTEGER,
          "name" VARCHAR(255) NOT NULL,
          "type" VARCHAR(255) NOT NULL,
          "status" VARCHAR(255) CHECK ("status" IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
          "parameters" JSONB DEFAULT '{}'::jsonb,
          "results" JSONB,
          "fileUrl" VARCHAR(255),
          "error" TEXT,
          "executionTime" INTEGER,
          "requestedBy" INTEGER NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✓ ReportExecutions table created');

    console.log('\n✅ All reporting tables updated successfully!');
    
    // Show current ReportTemplates structure
    const [results] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'ReportTemplates'
      ORDER BY ordinal_position;
    `);
    
    console.log('\nReportTemplates table structure:');
    console.table(results);

  } catch (error) {
    console.error('Error updating tables:', error);
  } finally {
    await sequelize.close();
  }
}

updateTables();
