import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workspaceTaskEnvironment } from './workspace-task.mjs'

await test('nested builds retain build settings while discarding invocation and browser-check metadata', () => {
  const env = {
    PATH: '/bin',
    NODE_ENV: 'production',
    VITE_ENDPOINT: 'http://lan',
    NEXT_PUBLIC_URL: 'http://vpn',
    CI: 'true',
    GITHUB_SHA: 'source-commit',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ID: '123',
    GITHUB_JOB: 'browser',
    GITHUB_STEP_SUMMARY: '/tmp/step-summary',
    INVOCATION_ID: 'one',
    JOURNAL_STREAM: 'one',
    ACTIONS_ORCHESTRATION_ID: 'one',
    ACTIONS_RUNTIME_URL: 'https://ci.example/one',
    RUNNER_NAME: 'host-one',
    CODEX_TOOL_CALL_ID: 'one',
    DOVO_DESIGN_INTERACTIONS_ONLY: '1',
    DOVO_BROWSER_TIMINGS: '/tmp/one.json',
  }
  const expected = {
    PATH: '/bin',
    NODE_ENV: 'production',
    VITE_ENDPOINT: 'http://lan',
    NEXT_PUBLIC_URL: 'http://vpn',
    CI: 'true',
    GITHUB_SHA: 'source-commit',
    GITHUB_REF: 'refs/heads/main',
  }
  assert.deepEqual(workspaceTaskEnvironment(env), expected)
  assert.deepEqual(
    workspaceTaskEnvironment({
      ...env,
      CODEX_TOOL_CALL_ID: 'two',
      GITHUB_RUN_ID: '456',
      GITHUB_JOB: 'design-system',
      RUNNER_NAME: 'host-two',
      ACTIONS_RUNTIME_URL: 'https://ci.example/two',
      DOVO_BROWSER_TIMINGS: '/tmp/two.json',
    }),
    expected,
  )
  assert.equal(env.CODEX_TOOL_CALL_ID, 'one')
})
