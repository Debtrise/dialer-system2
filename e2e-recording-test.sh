#!/bin/bash
# e2e-recording-test.sh

set -e  # Exit on any error

echo "🎯 Starting End-to-End Recording Test..."

# 1. Create recording
echo "📝 Creating recording..."
RECORDING_RESPONSE=$(curl -s -X POST "http://localhost:3001/api/recordings" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "E2E Test Recording",
    "description": "End-to-end test recording",
    "text": "Hello, this is a test recording for tenant testing. Welcome to our service!",
    "type": "tts",
    "tags": ["test", "e2e"]
  }')

RECORDING_ID=$(echo $RECORDING_RESPONSE | jq -r '.id')
echo "✅ Recording created with ID: $RECORDING_ID"

# 2. Generate audio
echo "🎵 Generating audio..."
GENERATE_RESPONSE=$(curl -s -X POST "http://localhost:3001/api/recordings/$RECORDING_ID/generate" \
  -H "Authorization: Bearer $JWT_TOKEN")

echo "✅ Audio generation result:"
echo $GENERATE_RESPONSE | jq .

# Wait for generation to complete
sleep 5

# 3. Upload to FreePBX
echo "🌐 Uploading to FreePBX..."
UPLOAD_RESPONSE=$(curl -s -X POST "http://localhost:3001/api/recordings/$RECORDING_ID/upload-to-freepbx" \
  -H "Authorization: Bearer $JWT_TOKEN")

echo "✅ Upload result:"
echo $UPLOAD_RESPONSE | jq .

# 4. Verify final status
echo "🔍 Verifying final status..."
FINAL_STATUS=$(curl -s -X GET "http://localhost:3001/api/recordings/$RECORDING_ID" \
  -H "Authorization: Bearer $JWT_TOKEN")

echo "✅ Final recording status:"
echo $FINAL_STATUS | jq '{id, name, freepbxStatus, freepbxRecordingId, fileName}'

# 5. Test audio download
echo "🎧 Testing audio download..."
curl -s -X GET "http://localhost:3001/api/recordings/$RECORDING_ID/audio" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -o "test_recording_$RECORDING_ID.mp3"

if [ -f "test_recording_$RECORDING_ID.mp3" ]; then
  FILE_SIZE=$(ls -l "test_recording_$RECORDING_ID.mp3" | awk '{print $5}')
  echo "✅ Audio file downloaded successfully ($FILE_SIZE bytes)"
  rm "test_recording_$RECORDING_ID.mp3"
else
  echo "❌ Audio file download failed"
fi

echo "🎉 End-to-End Test Complete!"
