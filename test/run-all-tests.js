#!/usr/bin/env node

/**
 * Test runner script for the Killer Game Sprint 1 tests
 * 
 * This script runs all tests and provides a summary report
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const testFiles = [
  'setup.js',
  'api.test.js',
  'database.test.js',
  'socket.test.js',
  'frontend.test.js',
  'victory-page.test.js',
  'game-summary.test.js',
  'kill-history.test.js',
  'endgame-socket.test.js',
  'game-summary-sorting.test.js',
  'game-summary.api.test',
];

console.log('🧪 Running Killer Game Sprint 1 Test Suite\n');
console.log('=' .repeat(50));

async function runTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  for (const testFile of testFiles) {
    if (testFile === 'setup.js') continue; // Skip setup file
    
    console.log(`\n📋 Running ${testFile}...`);
    console.log('-'.repeat(30));

    try {
      const result = await runSingleTest(testFile);
      
      if (result.success) {
        console.log(`✅ ${testFile} - All tests passed`);
        passedTests += result.testCount || 0;
      } else {
        console.log(`❌ ${testFile} - Some tests failed`);
        failedTests += result.failCount || 0;
        passedTests += result.passCount || 0;
      }
      
      totalTests += result.testCount || 0;
    } catch (error) {
      console.error(`💥 Error running ${testFile}:`, error.message);
      failedTests++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`📈 Success Rate: ${totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0}%`);
  
  if (failedTests === 0) {
    console.log('\n🎉 All tests passed! Sprint 1 implementation is solid.');
  } else {
    console.log('\n🔧 Some tests failed. Review the output above for details.');
    process.exit(1);
  }
}

function runSingleTest(testFile) {
  return new Promise((resolve, reject) => {
    const testPath = path.join(__dirname, testFile);
    const child = spawn('node', ['--test', testPath], {
      stdio: 'pipe',
      cwd: path.dirname(__dirname)
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // Parse Node.js test runner output
      const output = stdout + stderr;
      
      // Look for test results
      const passMatch = output.match(/✔ .* \((\d+)\)/g) || [];
      const failMatch = output.match(/✖ .* \((\d+)\)/g) || [];
      
      const passCount = passMatch.length;
      const failCount = failMatch.length;
      const testCount = passCount + failCount;

      // Print the actual test output
      console.log(output);

      resolve({
        success: code === 0,
        testCount,
        passCount,
        failCount,
        output
      });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the tests
runTests().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
