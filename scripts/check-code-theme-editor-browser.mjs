import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/studio-ui',
      loader: 'tsx',
      contents: `import {createRoot} from 'react-dom/client';
import {getHighlighterType} from '@pierre/diffs';window.highlighterType=getHighlighterType;
import {PierreEditor} from '${root}/packages/extension-tasks/src/review/pierre-editor.tsx';
import {importCodeTheme} from '${root}/packages/studio-core/src/code-themes.ts';
import {updateAppPreferences} from '${root}/packages/studio-core/src/preferences.ts';
window.saved=[];window.selectTheme=selection=>updateAppPreferences({codeTheme:selection});
window.importTheme=()=>{const theme=importCodeTheme(JSON.stringify({name:'Editor proof',type:'light',colors:{'editor.background':'#fefdfa','editor.foreground':'#123456'},tokenColors:[{scope:'keyword',settings:{foreground:'#c02d69'}}]}),'proof.json');updateAppPreferences({codeTheme:theme.name,importedCodeThemes:[theme]})};
createRoot(document.getElementById('app')).render(<PierreEditor taskId="proof" file={{path:'hello.ts',before:'export const n = 1;\\n',after:'export const n = 2;\\n'}} comments={[]} onSave={contents=>window.saved.push(contents)} onComment={async()=>{}}/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '${root}/packages/studio-core/src/preferences.ts';export * from '${root}/packages/studio-core/src/themes.ts';`,
    },
    {
      path: '@dovo/studio-core/state',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '@dovo/studio-ui',
      contents:
        'export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;export const LineCommentForm=()=>null;export const MessageResponse=({children})=>children;',
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://editor.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app" style="height:700px"></div>' }),
  )
  await page.goto('http://editor.test/')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction(() =>
    document.querySelector('diffs-container')?.shadowRoot?.textContent.includes('export'),
  )
  assert.equal(await page.evaluate(() => window.highlighterType()), 'highlights')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const input = page.locator('diffs-container [contenteditable="true"]')
  await input.waitFor()
  await input.focus()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('// retained draft')
  await input.evaluate((element) => {
    window.originalEditor = element
    window.beforeTheme = element.textContent
  })
  assert.ok(await input.textContent().then((value) => value.includes('retained draft')))
  await page.evaluate(() => window.selectTheme('dracula'))
  await page.waitForFunction(() =>
    document.querySelector('diffs-container')?.shadowRoot?.textContent.includes('retained draft'),
  )
  assert.equal(
    await input.evaluate(
      (element) => element === window.originalEditor && element.textContent === window.beforeTheme,
    ),
    true,
  )
  await page.evaluate(() => window.importTheme())
  await page.waitForFunction(() => {
    const shadow = document.querySelector('diffs-container')?.shadowRoot
    const token = [...(shadow?.querySelectorAll('span') ?? [])].find(
      (span) => span.childElementCount === 0 && span.textContent === 'export',
    )
    return token && getComputedStyle(token).color === 'rgb(192, 45, 105)'
  })
  assert.equal(
    await input.evaluate(
      (element) =>
        element === window.originalEditor &&
        element.textContent === window.beforeTheme &&
        document.activeElement === element.getRootNode().host,
    ),
    true,
  )
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.waitForFunction(() => window.saved.length === 1)
  assert.ok(await page.evaluate(() => window.saved[0].includes('retained draft')))
  assert.deepEqual(errors, [])
  console.log(
    'Real editor preserves unsaved text, focus and editor identity across palette/imported theme switches; save includes the draft.',
  )
} finally {
  await browser.close()
}
