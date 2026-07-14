require('dotenv').config();

const { validateReleaseSecurityEnvironment } = require('../src/utils/securityConfiguration');

try {
  const report = validateReleaseSecurityEnvironment();
  process.stdout.write(`${JSON.stringify({ success: true, ...report })}\n`);
} catch (error) {
  process.stderr.write(`Release security verification failed: ${error.message}\n`);
  process.exitCode = 1;
}
