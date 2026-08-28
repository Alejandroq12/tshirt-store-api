import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

try {
  require.resolve('prisma/package.json');
} catch {
  console.log('prisma CLI not installed; skipping client generation');
  process.exit(0);
}

const { status } = spawnSync('npx', ['prisma', 'generate'], {
  stdio: 'inherit',
});
process.exit(status ?? 1);
