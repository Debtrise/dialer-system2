// test-elevenlabs.js
const axios = require('axios');
require('dotenv').config();

async function testElevenLabs() {
  console.log('🎵 Testing Eleven Labs API...');
  
  if (!process.env.ELEVEN_LABS_API_KEY) {
    console.log('❌ ELEVEN_LABS_API_KEY not set');
    return;
  }
  
  try {
    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': process.env.ELEVEN_LABS_API_KEY },
      timeout: 10000
    });
    
    console.log('✅ Eleven Labs API connected');
    console.log(`📊 Available voices: ${response.data.voices.length}`);
    console.log('🎤 Sample voices:', response.data.voices.slice(0, 3).map(v => v.name));
    
  } catch (error) {
    console.log('❌ Eleven Labs API error:', error.response?.status, error.message);
  }
}

testElevenLabs();
