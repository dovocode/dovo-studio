import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const invocationMetadata = new Set([
  'INVOCATION_ID',
  'JOURNAL_STREAM',
  'RUNNER_NAME',
  'RUNNER_TRACKING_ID',
  'GITHUB_RUN_ID',
  'GITHUB_RUN_NUMBER',
  'GITHUB_RUN_ATTEMPT',
  'GITHUB_JOB',
  'GITHUB_ACTION',
  'GITHUB_ENV',
  'GITHUB_OUTPUT',
  'GITHUB_STATE',
  'GITHUB_PATH',
  'GITHUB_STEP_SUMMARY',
])

// Vite builds report their own environment fingerprints. Strip invocation metadata
// before starting the cache runner, so nested reports cannot reintroduce it.
export function workspaceTaskEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !/^(?:CODEX_|DOVO_DESIGN_|ACTIONS_)/.test(name) &&
        name !== 'DOVO_BROWSER_TIMINGS' &&
        !invocationMetadata.has(name),
    ),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const task = process.argv[2]
  if (!['build', 'typecheck'].includes(task))
    throw new Error('Usage: node scripts/ci/workspace-task.mjs build|typecheck')
  const result = spawnSync('pnpm', ['exec', 'vp', 'run', `ci-${task}`], {
    env: workspaceTaskEnvironment(process.env),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
