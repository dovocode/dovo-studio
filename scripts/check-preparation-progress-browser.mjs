import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PreparationProgress} from './src/chat/thread/preparation-progress';import {taskPreparation} from '@dovo/protocol';const root=createRoot(document.getElementById('app'));window.renderPreparation=(current,status='running')=>{const task={status,autoProject:true,runPhase:'preparing',preparation:{steps:['scope-context','scope','models','tune','maestro','fetch','pull','worktree','restore','setup','agent'],current,startedAt:new Date().toISOString(),failed:status==='failed'},error:status==='failed'?'Selector unavailable':undefined};const preparation=taskPreparation(task);flushSync(()=>root.render(preparation?<PreparationProgress preparation={preparation} onRetry={()=>window.retries=(window.retries??0)+1}/>:null))};window.renderPreparation('scope-context','draft');`,
    resolveDir: root + 'packages/extension-tasks',
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'button-only',
      setup(b) {
        b.onResolve({ filter: /^@dovo\/studio-ui$/ }, () => ({
          path: 'button',
          namespace: 'fixture',
        }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export {Button} from '${root}packages/studio-ui/src/components/ui/button.tsx'`,
          loader: 'tsx',
          resolveDir: root + 'packages/studio-ui',
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  alias: {
    '@dovo/protocol/browser-viewer': root + 'packages/protocol/src/browser-viewer.ts',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    react: root + 'packages/studio-ui/node_modules/react',
    'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
  },
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<html class="dark"><body><main id="app"></main></body></html>')
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const [step, name, status] of [
    ['scope-context', 'Scope', 'draft'],
    ['scope', 'Scope', 'draft'],
    ['tune', 'Tune', 'running'],
    ['maestro', 'Maestro', 'running'],
    ['models', 'Discovering models', 'running'],
    ['fetch', 'Fetching latest changes', 'running'],
    ['pull', 'Fetching pull request', 'running'],
    ['worktree', 'Creating worktree', 'running'],
    ['restore', 'Restoring worktree', 'running'],
    ['setup', 'Setting up the project', 'running'],
    ['agent', 'Starting the agent', 'running'],
  ]) {
    await page.evaluate(({ step, status }) => window.renderPreparation(step, status), {
      step,
      status,
    })
    await page
      .getByText(['Scope', 'Tune', 'Maestro'].includes(name) ? `${name} is working` : name, {
        exact: true,
      })
      .waitFor()
    const animation = page.locator('[data-activity] [class*="dovo-activity-breathe"]')
    assert.equal(
      await animation.evaluate((node) => getComputedStyle(node).animationName),
      'dovo-activity-breathe',
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await animation.evaluate((node) => getComputedStyle(node).animationName), 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const orbit = page.locator('[data-activity-orbit]')
    assert.equal(await orbit.evaluate((node) => getComputedStyle(node).animationName), 'spin')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await orbit.evaluate((node) => getComputedStyle(node).animationName), 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.equal(
      await page.getByRole('progressbar').getAttribute('aria-label'),
      await page.locator('[aria-current="step"]').innerText(),
    )
  }
  await page.evaluate(() => window.renderPreparation('worktree'))
  await page.getByText('Creating worktree', { exact: true }).waitFor()
  mkdirSync(root + 'work/preparation-progress', { recursive: true })
  await page.waitForFunction(
    () => Number(getComputedStyle(document.querySelector('section')).opacity) >= 0.99,
  )
  await page.screenshot({ path: root + 'work/preparation-progress/worktree.png' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => window.renderPreparation('worktree', 'failed'))
  await page.getByText('Worktree creation stopped', { exact: true }).waitFor()
  await page.getByRole('alert').filter({ hasText: 'Selector unavailable' }).waitFor()
  assert.equal(await page.locator('[data-activity] [class*="dovo-activity-breathe"]').count(), 0)
  assert.equal(await page.getByRole('progressbar').count(), 0)
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  assert.equal(await page.evaluate(() => window.retries), 1)
  assert.equal(await page.locator('[data-activity-orbit]').count(), 0)
  await page.evaluate(() => window.renderPreparation('agent'))
  await page.getByText('Starting the agent', { exact: true }).waitFor()
  await page.evaluate(() => window.renderPreparation('agent', 'review'))
  assert.equal(await page.getByRole('region', { name: 'Thread startup progress' }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    'Startup progress: real selector, fetch, worktree, restore, setup and agent stages, reduced motion, failures, retry, handoff and narrow layout pass.',
  )
} finally {
  await browser.close()
}
