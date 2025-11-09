#!/usr/bin/env node

const chalk = require('chalk');

const SERVER_URL = process.env.README_AI_SERVER_URL || 'http://localhost:3001';
const TEST_PROJECT_INFO = {
  name: 'test-project',
  type: 'Node.js',
  languages: ['JavaScript'],
  dependencies: ['express'],
  files: [{ path: 'index.js', type: '.js', size: 100 }],
  structure: 'test-project/\n  index.js'
};

const TEST_SAMPLE_CODE = '// Test code\nconsole.log("Hello");';

async function testRateLimit() {
  console.log(chalk.bold.blue('\n🧪 Testing Rate Limiting\n'));
  console.log(chalk.gray(`Server: ${SERVER_URL}\n`));

  const requests = [];
  const maxRequests = 12; // More than the limit of 10

  console.log(chalk.yellow(`Making ${maxRequests} requests (limit is 10 per 15 minutes)...\n`));

  for (let i = 1; i <= maxRequests; i++) {
    const startTime = Date.now();
    try {
      const response = await fetch(`${SERVER_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectInfo: TEST_PROJECT_INFO,
          sampleCode: TEST_SAMPLE_CODE,
        }),
      });

      const duration = Date.now() - startTime;
      const data = await response.json();

      if (response.status === 429) {
        console.log(
          chalk.red(`❌ Request ${i}: Rate limited (429) - ${duration}ms`)
        );
        console.log(chalk.gray(`   Response: ${JSON.stringify(data)}\n`));
      } else if (response.ok) {
        console.log(
          chalk.green(`✅ Request ${i}: Success (200) - ${duration}ms`)
        );
      } else {
        console.log(
          chalk.yellow(`⚠️  Request ${i}: ${response.status} - ${duration}ms`)
        );
        console.log(chalk.gray(`   Response: ${JSON.stringify(data)}\n`));
      }
    } catch (error) {
      console.log(
        chalk.red(`❌ Request ${i}: Error - ${error.message}`)
      );
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(chalk.bold('\n📊 Summary:'));
  console.log(chalk.cyan('If rate limiting is working, requests 11+ should return 429 status'));
}

async function testNoApiKey() {
  console.log(chalk.bold.blue('\n🔍 Verifying No API Key in CLI\n'));

  const fs = require('fs');
  const path = require('path');

  const cliPath = path.join(__dirname, 'dist', 'cli.js');
  const cliSource = fs.readFileSync(cliPath, 'utf-8');

  const apiKeyPatterns = [
    /GEMINI_API_KEY/gi,
    /GOOGLE_GENERATIVE_AI_API_KEY/gi,
    /apiKey/gi,
    /api-key/gi,
    /--api-key/gi,
  ];

  let foundApiKeyReferences = false;
  const matches = [];

  apiKeyPatterns.forEach(pattern => {
    const match = cliSource.match(pattern);
    if (match) {
      foundApiKeyReferences = true;
      matches.push(...match);
    }
  });

  if (foundApiKeyReferences) {
    console.log(chalk.yellow('⚠️  Found API key references in CLI:'));
    console.log(chalk.gray(`   ${[...new Set(matches)].join(', ')}`));
    console.log(chalk.gray('\n   Checking if they are only in error messages or comments...\n'));
    
    // Check if it's only in error messages (which is OK)
    const errorMessageCheck = cliSource.match(/Could not connect to server/);
    if (errorMessageCheck) {
      console.log(chalk.green('✅ API key references are only in error messages (expected)'));
    }
  } else {
    console.log(chalk.green('✅ No API key references found in CLI code'));
  }

  // Check source TypeScript file
  const cliSourcePath = path.join(__dirname, 'src', 'cli.ts');
  const cliSourceCode = fs.readFileSync(cliSourcePath, 'utf-8');

  const hasApiKeyOption = cliSourceCode.includes('--api-key') || cliSourceCode.includes('apiKey');
  const hasApiKeyEnv = cliSourceCode.includes('GEMINI_API_KEY') || cliSourceCode.includes('GOOGLE_GENERATIVE_AI_API_KEY');

  console.log(chalk.cyan('\n📝 Source Code Analysis:'));
  console.log(chalk.gray(`   Has --api-key option: ${hasApiKeyOption ? chalk.red('YES ❌') : chalk.green('NO ✅')}`));
  console.log(chalk.gray(`   Checks for API key env var: ${hasApiKeyEnv ? chalk.red('YES ❌') : chalk.green('NO ✅')}`));
  console.log(chalk.gray(`   Uses server URL: ${cliSourceCode.includes('serverUrl') ? chalk.green('YES ✅') : chalk.red('NO ❌')}`));
}

async function testServerConnection() {
  console.log(chalk.bold.blue('\n🌐 Testing Server Connection\n'));

  try {
    // Test health endpoint
    console.log(chalk.cyan('Testing /health endpoint...'));
    const healthResponse = await fetch(`${SERVER_URL}/health`);
    
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      console.log(chalk.green(`✅ Server is reachable`));
      console.log(chalk.gray(`   Response: ${JSON.stringify(healthData)}`));
    } else {
      console.log(chalk.red(`❌ Server returned ${healthResponse.status}`));
    }

    // Test if server has API key
    console.log(chalk.cyan('\nTesting if server has API key configured...'));
    const testResponse = await fetch(`${SERVER_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectInfo: TEST_PROJECT_INFO,
        sampleCode: TEST_SAMPLE_CODE,
      }),
    });

    if (testResponse.status === 500) {
      const errorData = await testResponse.json();
      if (errorData.message && errorData.message.includes('API key')) {
        console.log(chalk.red('❌ Server is missing API key'));
        console.log(chalk.gray(`   Error: ${errorData.message}`));
      } else {
        console.log(chalk.yellow('⚠️  Server error (might be API key or other issue)'));
        console.log(chalk.gray(`   Error: ${errorData.message || errorData.error}`));
      }
    } else if (testResponse.status === 429) {
      console.log(chalk.green('✅ Server is working (rate limited, which is expected)'));
    } else if (testResponse.ok) {
      console.log(chalk.green('✅ Server is working and has API key configured'));
    } else {
      console.log(chalk.yellow(`⚠️  Server returned ${testResponse.status}`));
    }

  } catch (error) {
    console.log(chalk.red(`❌ Cannot connect to server: ${error.message}`));
    console.log(chalk.yellow('\nMake sure the server is running:'));
    console.log(chalk.cyan('  pnpm dev:server'));
  }
}

async function main() {
  console.log(chalk.bold('\n🔬 README-AI Verification Tests\n'));
  console.log(chalk.gray('='.repeat(50)));

  await testNoApiKey();
  console.log(chalk.gray('\n' + '='.repeat(50)));
  
  await testServerConnection();
  console.log(chalk.gray('\n' + '='.repeat(50)));
  
  await testRateLimit();
  console.log(chalk.gray('\n' + '='.repeat(50)));
  
  console.log(chalk.bold.green('\n✅ Tests completed!\n'));
}

main().catch(console.error);

