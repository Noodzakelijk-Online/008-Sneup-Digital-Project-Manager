const recommendationEvaluationService = require('../src/services/recommendationEvaluationService');

const report = recommendationEvaluationService.runSuite();
console.log(JSON.stringify(report, null, 2));

if (report.failed > 0) process.exitCode = 1;
