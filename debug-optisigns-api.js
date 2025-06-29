// debug-optisigns-api.js
// Script to test and debug the actual Optisigns GraphQL API

const axios = require('axios');

async function testOptisignsAPI(apiToken) {
  console.log('🔍 Testing Optisigns GraphQL API...');
  console.log('Token (last 4 chars):', apiToken.slice(-4));
  
  const client = axios.create({
    baseURL: 'https://graphql-gateway.optisigns.com',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Knittt-Debug/1.0'
    },
    timeout: 10000
  });

  // Test different endpoints and queries
  const tests = [
    {
      name: 'Basic endpoint test',
      method: 'GET',
      url: '/',
      expectStatus: [200, 404, 405] // GraphQL usually returns 405 for GET
    },
    {
      name: 'GraphQL endpoint test',
      method: 'GET', 
      url: '/graphql',
      expectStatus: [200, 404, 405]
    },
    {
      name: 'Simple introspection query',
      method: 'POST',
      url: '/',
      data: {
        query: `query { __schema { queryType { name } } }`
      },
      expectStatus: [200, 400]
    },
    {
      name: 'Me query test',
      method: 'POST',
      url: '/',
      data: {
        query: `query { me { id } }`
      },
      expectStatus: [200, 400]
    },
    {
      name: 'User query test', 
      method: 'POST',
      url: '/',
      data: {
        query: `query { user { id } }`
      },
      expectStatus: [200, 400]
    },
    {
      name: 'Viewer query test',
      method: 'POST', 
      url: '/',
      data: {
        query: `query { viewer { id } }`
      },
      expectStatus: [200, 400]
    },
    {
      name: 'Account query test',
      method: 'POST',
      url: '/',
      data: {
        query: `query { account { id name } }`
      },
      expectStatus: [200, 400]
    },
    {
      name: 'Displays query test',
      method: 'POST',
      url: '/',
      data: {
        query: `query { displays { id name } }`
      },
      expectStatus: [200, 400]
    },
    {
      name: 'Displays with pagination',
      method: 'POST',
      url: '/',
      data: {
        query: `query { displays(first: 5) { edges { node { id name } } } }`
      },
      expectStatus: [200, 400]
    }
  ];

  const results = [];

  for (const test of tests) {
    try {
      console.log(`\n🧪 Testing: ${test.name}`);
      
      let response;
      if (test.method === 'GET') {
        response = await client.get(test.url);
      } else {
        response = await client.post(test.url, test.data);
      }
      
      const success = test.expectStatus.includes(response.status);
      console.log(`   Status: ${response.status} ${success ? '✅' : '❌'}`);
      
      if (response.data) {
        if (typeof response.data === 'string') {
          console.log(`   Response: ${response.data.substring(0, 200)}...`);
        } else {
          console.log(`   Response:`, JSON.stringify(response.data, null, 2).substring(0, 500));
        }
      }
      
      results.push({
        test: test.name,
        status: response.status,
        success,
        data: response.data,
        error: null
      });
      
    } catch (error) {
      const status = error.response?.status || 'Network Error';
      const success = test.expectStatus.includes(status);
      
      console.log(`   Status: ${status} ${success ? '✅' : '❌'}`);
      console.log(`   Error: ${error.message}`);
      
      if (error.response?.data) {
        console.log(`   Error Data:`, JSON.stringify(error.response.data, null, 2).substring(0, 300));
      }
      
      results.push({
        test: test.name,
        status,
        success,
        data: error.response?.data,
        error: error.message
      });
    }
  }

  console.log('\n📊 Test Results Summary:');
  results.forEach(result => {
    console.log(`${result.success ? '✅' : '❌'} ${result.test}: ${result.status}`);
  });

  // Find working queries
  const workingQueries = results.filter(r => r.success && r.status === 200);
  if (workingQueries.length > 0) {
    console.log('\n🎯 Working queries found:');
    workingQueries.forEach(q => {
      console.log(`   ${q.test}`);
    });
  }

  return results;
}

// Test with different GraphQL endpoints
async function testAlternativeEndpoints(apiToken) {
  console.log('\n🔍 Testing alternative endpoints...');
  
  const endpoints = [
    'https://graphql-gateway.optisigns.com',
    'https://graphql-gateway.optisigns.com/graphql',
    'https://api.optisigns.com/graphql',
    'https://api.optisigns.com/v1/graphql'
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`\n🌐 Testing endpoint: ${endpoint}`);
      
      const client = axios.create({
        baseURL: endpoint,
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      const response = await client.post('/', {
        query: 'query { __typename }'
      });

      console.log(`   ✅ ${endpoint} - Status: ${response.status}`);
      
    } catch (error) {
      console.log(`   ❌ ${endpoint} - Error: ${error.response?.status || error.message}`);
    }
  }
}

// Usage function
async function runDebugTests(apiToken) {
  if (!apiToken) {
    console.error('❌ Please provide an API token');
    console.log('Usage: node debug-optisigns-api.js YOUR_API_TOKEN');
    return;
  }

  try {
    await testOptisignsAPI(apiToken);
    await testAlternativeEndpoints(apiToken);
    
    console.log('\n🎯 Next Steps:');
    console.log('1. Check which queries worked above');
    console.log('2. Use working query structure in optisigns-service.js');
    console.log('3. Update GraphQL queries to match working patterns');
    console.log('4. Test the Optisigns GraphQL IDE at: https://graphql-gateway.optisigns.com/graphql');
    
  } catch (error) {
    console.error('❌ Debug test failed:', error.message);
  }
}

// Allow running as script
if (require.main === module) {
  const apiToken = process.argv[2];
  runDebugTests(apiToken);
}

module.exports = { testOptisignsAPI, testAlternativeEndpoints, runDebugTests };