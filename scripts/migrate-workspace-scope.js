require('dotenv').config();

const { connectDatabase, disconnectDatabase } = require('../src/utils/database');
const workspaceScopeService = require('../src/services/workspaceScopeService');

const usage = () => [
  'Usage: npm run migrate:workspace [-- --apply] [-- --concurrency <1-16>]',
  '',
  'Without --apply, Sneup only inspects legacy records missing workspaceId.',
  '--apply creates the default workspace if needed, backfills those records, and replaces legacy global control indexes.'
].join('\n');

const parseArgs = (args) => {
  const options = { apply: false, concurrency: undefined };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--concurrency') {
      const value = args[index + 1];
      if (!value) throw new Error('--concurrency requires a value from 1 to 16');
      options.concurrency = value;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (process.env.SNEUP_DEMO_MODE === 'true') {
    throw new Error('Workspace migration cannot run in SNEUP_DEMO_MODE=true. Connect MongoDB first.');
  }

  const concurrency = workspaceScopeService.getBackfillConcurrency(options.concurrency);
  await connectDatabase();

  try {
    const report = options.apply
      ? {
        ...(await workspaceScopeService.backfillDefaultWorkspace({ concurrency })),
        policyRuleIndexes: await workspaceScopeService.ensurePolicyRuleIndexes(),
        jobControlIndexes: await workspaceScopeService.ensureJobControlIndexes()
      }
      : await workspaceScopeService.inspectDefaultWorkspaceBackfill({ concurrency });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
};

main().catch((error) => {
  process.stderr.write(`Workspace migration failed: ${error.message}\n`);
  process.exitCode = 1;
});
