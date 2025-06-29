// Create a file called init-node-types.js in your project root
const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Use the same database connection info as your main app
const sequelize = new Sequelize('dialer_system', 'dialerapp', 'password123', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false
});

async function initNodeTypes() {
  // Load models
  const models = require('./dialplan-builder/models/index')(sequelize);
  const { NodeType, NodeProperty } = models;
  
  // Check if node types exist
  const count = await NodeType.count();
  if (count > 0) {
    console.log('Node types already exist. Skipping initialization.');
    return;
  }
  
  // Load default node types
  const defaultTypesPath = path.join(__dirname, 'dialplan-builder', 'data', 'default-node-types.json');
  if (!fs.existsSync(defaultTypesPath)) {
    console.error('default-node-types.json not found at:', defaultTypesPath);
    return;
  }
  
  const defaultNodeTypes = JSON.parse(fs.readFileSync(defaultTypesPath, 'utf8'));
  
  // Create node types
  console.log(`Creating ${defaultNodeTypes.length} node types...`);
  for (const typeData of defaultNodeTypes) {
    const { properties, ...nodeType } = typeData;
    
    console.log(`Creating node type: ${nodeType.name}`);
    const createdType = await NodeType.create({
      ...nodeType,
      isSystem: true
    });
    
    if (properties && Array.isArray(properties)) {
      for (const prop of properties) {
        await NodeProperty.create({
          ...prop,
          nodeTypeId: createdType.id
        });
      }
    }
  }
  
  console.log('Node types initialized successfully!');
}

// Run the function
initNodeTypes()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
