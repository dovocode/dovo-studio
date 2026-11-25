import { spawnSync } from 'node:child_process'

function run(command, ...args) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('pnpm', 'changelog:check')
run('pnpm', 'check:mobile-copy')
run('node', 'scripts/ci/workspace-task.mjs', 'build')
run('pnpm', 'check:interface-catalogs')
run('pnpm', 'test:ci:scripts')
run('pnpm', 'check')
run('node', 'scripts/ci/workspace-task.mjs', 'typecheck')
run('node', 'scripts/check-runtime-sync.mjs')
run(
  'pnpm',
  'exec',
  'vp',
  'test',
  '--maxWorkers=4',
  'packages/runtime/src/agent-tools/context-budget.test.ts',
  'packages/runtime/src/agents/tasks/memory-protection.test.ts',
  'packages/runtime/src/scm/repositories/bounded-file-read.test.ts',
)
run('pnpm', 'exec', 'playwright', 'install', 'chromium')
run('pnpm', 'test:command-palette:browser')
run('node', 'scripts/check-web-workbench-history-browser.mjs')
run('node', 'scripts/check-mobile-thread-files-browser.mjs')
