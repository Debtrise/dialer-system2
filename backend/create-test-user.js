// save as create-test-user.js in backend directory
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/dialer-system');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  tenantId: { type: String, required: true },
  role: { type: String, enum: ['admin', 'agent'], default: 'agent' }
});

const User = mongoose.model('User', userSchema);

async function createTestUser() {
  try {
    // Create a simple test user with a fixed tenantId
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('test123', salt);
    
    await User.deleteMany({ username: 'test' }); // Remove existing test users
    
    const user = new User({
      username: 'test',
      password: hashedPassword,
      email: 'test@example.com',
      tenantId: 'test123', // Simple tenant ID for testing
      role: 'admin'
    });
    
    await user.save();
    console.log('Test user created successfully');
    console.log('Username: test');
    console.log('Password: test123');
    mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    mongoose.connection.close();
  }
}

createTestUser();
