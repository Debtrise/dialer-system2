const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001/api';
const TOKEN = process.env.API_TOKEN || 'YOUR_TOKEN';
const REP_EMAIL = process.env.REP_EMAIL || 'salesrep@example.com';
const REP_NAME = process.env.REP_NAME || 'Sales Rep';
const PHOTO_PATH = process.env.PHOTO_PATH || './test.jpg';
const DISPLAY_NAME = process.env.DISPLAY_NAME || 'KASH office';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Authorization': `Bearer ${TOKEN}` }
});

async function uploadPhoto() {
  console.log('\n📸 Uploading sales rep photo...');
  const form = new FormData();
  form.append('photo', fs.createReadStream(PHOTO_PATH));
  form.append('repEmail', REP_EMAIL);
  form.append('repName', REP_NAME);

  const res = await api.post('/sales-rep-photos/upload', form, {
    headers: form.getHeaders()
  });
  console.log('✅ Photo uploaded:', res.data.id);
  return res.data;
}

async function searchPhoto() {
  console.log('\n🔍 Searching photo by email...');
  const res = await api.get(`/sales-rep-photos/by-email/${encodeURIComponent(REP_EMAIL)}`);
  console.log('✅ Photo found:', res.data.id);
  return res.data;
}

async function createProject() {
  console.log('\n🎨 Creating project with sales rep photo element...');
  const projectData = {
    name: 'Sales Rep Photo Test',
    category: 'announcement',
    canvasSize: { width: 1920, height: 1080 },
    projectData: {
      elements: {
        photo: {
          elementType: 'sales_rep_photo',
          position: { x: 760, y: 240, z: 1 },
          size: { width: 400, height: 400 },
          properties: { src: '{rep_photo}', fit: 'cover' }
        },
        name: {
          elementType: 'text',
          position: { x: 960, y: 700, z: 1 },
          size: { width: 1000, height: 100 },
          properties: { text: '{rep_name}', fontSize: 48, textAlign: 'center' }
        }
      },
      variables: {
        rep_name: { type: 'text', default: REP_NAME },
        rep_email: { type: 'text', default: REP_EMAIL },
        rep_photo: { type: 'image', default: '' }
      },
      isPublic: false
    }
  };

  const res = await api.post('/content/projects', projectData);
  console.log('✅ Project created:', res.data.project.id);
  return res.data.project;
}

async function createWebhook(projectId) {
  console.log('\n🔗 Creating webhook for announcement...');
  const webhookData = {
    name: 'Sales Rep Photo Test Webhook',
    webhookType: 'announcement',
    endpointKey: `rep_photo_${Date.now()}`,
    isActive: true,
    announcementConfig: {
      enabled: true,
      contentCreator: {
        projectId,
        variableMapping: {
          rep_name: 'salesRep.name',
          rep_email: 'salesRep.email'
        },
        defaultValues: {
          rep_name: REP_NAME,
          rep_email: REP_EMAIL
        }
      },
      optisigns: {
        displaySelection: { mode: 'all' },
        takeover: { priority: 'NORMAL', duration: 20, restoreAfter: true }
      }
    }
  };

  const res = await api.post('/webhooks', webhookData);
  console.log('✅ Webhook created:', res.data.endpointKey);
  return res.data;
}

async function findDisplayId(name) {
  console.log(`\n📺 Searching for display "${name}"...`);
  const res = await api.get('/optisigns/displays?limit=100');
  const display = res.data.displays.find(d => d.name.toLowerCase() === name.toLowerCase());
  if (!display) throw new Error('Display not found');
  console.log('✅ Display found:', display.id);
  return display.id;
}

async function publishProject(projectId, displayId) {
  console.log('\n🚀 Publishing project to display...');
  const res = await api.post(`/content/projects/${projectId}/publish`, { displayIds: [displayId] });
  console.log('✅ Publish initiated');
  return res.data;
}

async function run() {
  try {
    const photo = await uploadPhoto();
    await searchPhoto();
    const project = await createProject();
    await createWebhook(project.id);
    const displayId = await findDisplayId(DISPLAY_NAME);
    const publishRes = await publishProject(project.id, displayId);
    console.log('\n📊 Publish summary:', publishRes.summary);
    console.log('🌐 Public URL:', publishRes.export?.publicUrl);
    console.log('\n✅ Workflow completed');
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

if (require.main === module) {
  run();
}

module.exports = run;

