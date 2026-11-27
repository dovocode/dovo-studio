import { availableParallelism } from 'node:os'
import { runCheck } from './run-check.mjs'

async function runSteps(steps) {
  for (const [command, ...args] of steps) {
    const label = [command, ...args].join(' ')
    console.log(`\n> ${label}`)
    const started = performance.now()
    const code = await runCheck(command, args)
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    if (code !== 0) {
      console.error(`${label} failed after ${seconds}s (exit ${code})`)
      return code
    }
    console.log(`${label} passed in ${seconds}s`)
  }
  return 0
}

const preparation = await runSteps([
  ['pnpm', 'changelog:check'],
  ['pnpm', 'check:mobile-copy'],
  ['node', 'scripts/ci/workspace-task.mjs', 'build'],
  ['pnpm', 'check'],
  ['node', 'scripts/ci/workspace-task.mjs', 'typecheck'],
  ['pnpm', 'exec', 'playwright', 'install', 'chromium'],
])
if (preparation !== 0) process.exit(preparation)

const checks = [
  [
    ['node', 'scripts/check-web-workbench-history-browser.mjs'],
    ['node', 'scripts/check-desktop-stage-first-browser.mjs'],
    ['node', 'scripts/check-pdf-continuity-browser.mjs'],
    ['node', 'scripts/check-mobile-integration-continuity-browser.mjs'],
    ['node', 'scripts/check-native-audit-browser.mjs'],
  ],
  [
    ['pnpm', 'test:command-palette:browser'],
    ['node', 'scripts/check-desktop-source-readers-browser.mjs'],
    ['node', 'scripts/check-checkpoint-diff-browser.mjs'],
    ['node', 'scripts/check-project-file-preview-browser.mjs'],
    ['node', 'scripts/check-mobile-thread-files-browser.mjs'],
    ['node', 'scripts/check-browser-tabs-browser.mjs'],
    ['node', 'scripts/check-mobile-automation-actions-browser.mjs'],
  ],
  [
    ['node', 'scripts/check-mobile-sheet-layout-browser.mjs'],
    ['node', 'scripts/check-mobile-bots-browser.mjs'],
    ['node', 'scripts/check-mobile-draft-transition-browser.mjs'],
    ['pnpm', 'check:interface-catalogs'],
    ['pnpm', 'test:ci:scripts'],
    ['node', 'scripts/check-runtime-sync.mjs'],
    [
      'pnpm',
      'exec',
      'vp',
      'test',
      '--maxWorkers=4',
      'packages/runtime/src/agent-tools/context-budget.test.ts',
      'packages/runtime/src/agent-tools/imports.test.ts',
      'packages/runtime/src/agents/tasks/memory-protection.test.ts',
      'packages/runtime/src/scm/repositories/bounded-file-read.test.ts',
    ],
  ],
]
const results =
  availableParallelism() >= 8
    ? await Promise.all(checks.map(runSteps))
    : [await runSteps(checks.flat())]
process.exitCode = results.find((code) => code !== 0) ?? 0
