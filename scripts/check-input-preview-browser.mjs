import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/desktop',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {InputPreviewWindow} from './src/input-preview';
const initial={key:'request-1',runtimeId:'local',runtimeName:'This computer',taskTitle:'Review a command',connected:true,waiting:1,request:{kind:'approval',value:{id:'approval-1',taskId:'task',title:'Run project checks?',detail:JSON.stringify({command:'pnpm test',cwd:'/workspace/project',reason:'Verify the change',threadId:'internal-thread-id'})}}};
window.answers=[];window.opens=0;window.dismissals=0;
const bridge={current:async()=>initial,subscribe:listener=>{window.updatePreview=listener;return ()=>{}},answer:async value=>{window.answers.push(value);if(window.failAnswer)throw Error('Could not reach computer');if(window.holdAnswer)await new Promise(resolve=>window.finishAnswer=resolve)},dismiss:async()=>{window.dismissals++},openThread:async()=>{window.opens++}};
window.initialPreview=initial;
createRoot(document.getElementById('app')).render(<InputPreviewWindow bridge={bridge}/>);
`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [{ path: '@dovo/studio-shell', contents: 'export const useAppearance=()=>{};' }],
)

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 560 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<html class="dark"><body style="margin:0"><div id="app"></div></body></html>',
  )
  for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
    file.endsWith('.css'),
  ))
    await page.addStyleTag({
      content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
    })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('heading', { name: 'Run project checks?' }).waitFor()
  await page.locator('dt').getByText('Working folder', { exact: true }).waitFor()
  assert.equal(
    await page.locator('dd').getByText('/workspace/project', { exact: true }).isVisible(),
    true,
  )
  assert.equal(await page.locator('dd').getByText('pnpm test', { exact: true }).isVisible(), true)
  assert.equal(
    await page.locator('dd').getByText('Verify the change', { exact: true }).isVisible(),
    true,
  )
  const raw = page.locator('details pre')
  assert.equal(await raw.isVisible(), false, 'Raw JSON is collapsed by default')
  await page.getByText('Full JSON', { exact: true }).click()
  assert.match(await raw.textContent(), /internal-thread-id/)
  await page.getByText('Full JSON', { exact: true }).click()
  await page.evaluate(() => window.updatePreview({ ...window.initialPreview, connected: false }))
  await page.getByRole('status').waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Allow once', exact: true }).isDisabled(),
    true,
  )
  assert.equal(await page.getByRole('button', { name: 'Deny', exact: true }).isDisabled(), true)
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('y')
  await page.keyboard.press('Enter')
  assert.equal(
    await page.evaluate(() => window.answers.length),
    0,
    'Offline shortcuts cannot answer',
  )
  await page.evaluate(() => {
    window.failAnswer = true
    window.updatePreview(window.initialPreview)
  })
  await page.getByRole('button', { name: 'Allow once', exact: true }).click()
  await page.getByRole('alert').getByText('Could not reach computer', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.failAnswer = false
    window.holdAnswer = true
  })
  await page.getByRole('button', { name: 'Deny', exact: true }).click()
  await page.waitForFunction(() => typeof window.finishAnswer === 'function')
  assert.equal(
    await page.getByRole('button', { name: 'Allow once', exact: true }).isDisabled(),
    true,
  )
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('n')
  await page.keyboard.press('Enter')
  assert.equal(
    await page.evaluate(() => window.answers.length),
    2,
    'Busy shortcuts cannot double-answer',
  )
  await page.evaluate(() => window.finishAnswer())
  await page.waitForFunction(() => !document.querySelector('button[disabled]'))
  assert.deepEqual(await page.evaluate(() => window.answers), [
    { key: 'request-1', answer: true },
    { key: 'request-1', answer: false },
  ])
  await page.evaluate(() =>
    window.updatePreview({
      ...window.initialPreview,
      key: 'request-2',
      request: {
        kind: 'approval',
        value: {
          ...window.initialPreview.request.value,
          id: 'approval-2',
          detail: 'Please review <img src=x onerror=alert(1)> before continuing.',
        },
      },
    }),
  )
  await page
    .getByText('Please review <img src=x onerror=alert(1)> before continuing.', { exact: true })
    .waitFor()
  assert.equal(await page.locator('main img').count(), 0, 'Permission content renders as text')
  assert.equal(
    await page.getByText('Full JSON', { exact: true }).count(),
    0,
    'Plain text remains readable without a JSON disclosure',
  )
  await page.evaluate(() =>
    window.updatePreview({
      ...window.initialPreview,
      key: 'request-3',
      request: {
        kind: 'approval',
        value: {
          ...window.initialPreview.request.value,
          detail: JSON.stringify({
            reason: 'Review this long command',
            command: 'x'.repeat(3000),
            input: { file_path: '/workspace/file.ts', description: 'Update a file' },
          }),
        },
      },
    }),
  )
  await page.getByText('Tool input', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'Details fit the popup width',
  )
  mkdirSync(root + 'work/input-preview', { recursive: true })
  await page.screenshot({ path: root + 'work/input-preview/permission.png' })
  await page.getByRole('button', { name: 'Open thread', exact: true }).click()
  await page.getByRole('button', { name: 'Dismiss for now', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => [window.opens, window.dismissals]), [1, 1])
  await page.evaluate(() => {
    window.holdAnswer = false
    window.answers = []
  })
  for (const [key, allow] of [
    ['y', true],
    ['Shift+Y', true],
    ['n', false],
    ['Shift+N', false],
    ['Enter', true],
  ]) {
    await page.evaluate(() => document.activeElement?.blur())
    const count = await page.evaluate(() => window.answers.length)
    await page.keyboard.press(key)
    await page.waitForFunction((count) => window.answers.length === count + 1, count)
    assert.equal(await page.evaluate(() => window.answers.at(-1).answer), allow)
    await page.waitForFunction(() => !document.querySelector('button[disabled]'))
  }
  await page.getByRole('button', { name: 'Deny', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.answers.length === 6)
  assert.equal(
    await page.evaluate(() => window.answers.at(-1).answer),
    false,
    'Enter preserves the focused Deny action',
  )
  await page.evaluate(() => {
    document.activeElement?.blur()
    document.body.insertAdjacentHTML(
      'beforeend',
      '<input aria-label="Typing test"><div role="dialog">Another dialog</div>',
    )
  })
  await page.keyboard.press('y')
  assert.equal(
    await page.evaluate(() => window.answers.length),
    6,
    'An unrelated dialog owns the keyboard',
  )
  await page.evaluate(() => document.querySelector('[role="dialog"]').remove())
  await page.getByLabel('Typing test').focus()
  await page.keyboard.press('y')
  await page.keyboard.press('n')
  await page.keyboard.press('Enter')
  assert.equal(
    await page.evaluate(() => window.answers.length),
    6,
    'Typing never answers an approval',
  )
  await page.evaluate(() => {
    document.querySelector('input').remove()
    document.activeElement?.blur()
    for (const options of [
      { repeat: true },
      { isComposing: true },
      { ctrlKey: true },
      { altKey: true },
    ]) {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', bubbles: true, ...options }),
      )
    }
  })
  assert.equal(
    await page.evaluate(() => window.answers.length),
    6,
    'Composition, held keys and modifiers are ignored',
  )
  await page.evaluate(() =>
    window.updatePreview({
      ...window.initialPreview,
      key: 'question-1',
      request: {
        kind: 'question',
        value: {
          id: 'question-1',
          taskId: 'task',
          prompt: {
            title: 'Choose the next step',
            blocking: true,
            questions: [
              {
                id: 'next',
                header: 'Next step',
                question: 'Continue?',
                required: true,
                multiple: false,
                custom: false,
                options: [{ value: 'continue', label: 'Continue' }],
              },
            ],
          },
        },
      },
    }),
  )
  await page.getByRole('form', { name: 'Agent questions' }).waitFor()
  await page.locator('main').evaluate((element) => element.setAttribute('role', 'dialog'))
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('Enter')
  await page.getByRole('alert').waitFor()
  assert.equal(
    await page.evaluate(() => window.answers.length),
    6,
    'Enter in a question dialog still validates required answers',
  )
  await page.keyboard.press('1')
  await page.getByRole('button', { name: /Continue/, pressed: true }).waitFor()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.answers.length === 7)
  assert.deepEqual(await page.evaluate(() => window.answers.at(-1)), {
    key: 'question-1',
    answer: { next: ['continue'] },
  })
  assert.deepEqual(errors, [])
  console.log(
    'Permission popup: formatted fields, Full JSON, plain text, escaping, narrow layout, offline/busy gating, keyboard approvals, question submission and answer routing passed.',
  )
} finally {
  await browser.close()
}
