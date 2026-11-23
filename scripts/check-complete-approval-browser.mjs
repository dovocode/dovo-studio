import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const native = `export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children})=><span>{children}</span>;export const Pressable=({children,onPress,accessibilityLabel})=><button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;export const useTheme=()=>({styles:{text:{},muted:{}},colors:{}});`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import{useState}from'react';import{createRoot}from'react-dom/client';
import{ApprovalDetails as Desktop}from'./packages/extension-tasks/src/chat/actions/approval-details';import{ApprovalDetails as Mobile}from'./apps/mobile/src/tasks/detail/approval-details';
function App(){const[mode,setMode]=useState('desktop'),[detail,setDetail]=useState('');window.show=(mode,detail)=>{setMode(mode);setDetail(detail)};return <><textarea aria-label="Draft" defaultValue="Keep my draft"/>{detail&&<section key={mode}>{mode==='desktop'?<Desktop detail={detail}/>:<Mobile detail={detail}/>}</section>}</>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: '@dovo/studio-ui',
      contents: `export {Button} from '${root}packages/studio-ui/src/components/ui/button'`,
    },
    { path: 'react-native', contents: native },
    { path: '../../ui/content/text', importer: mobile + 'tasks/detail/', contents: native },
    {
      path: '../../ui/content/clipboard',
      importer: mobile + 'tasks/detail/',
      contents: 'export const copyText=async text=>{window.copied=text;return "copied"};',
    },
    { path: '../../ui/theme', importer: mobile + 'tasks/detail/', contents: native },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const payloads = [
    { command: 'printf ' + 'long-command '.repeat(5000) + 'COMMAND-END' },
    {
      server: 'test',
      tool: 'inspect',
      arguments: Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => ['field' + i, 'value' + i]),
      ),
      tail: 'MCP-END',
    },
    { action: { kind: 'command', command: 'resolved form ' + 'field '.repeat(5000) + 'FORM-END' } },
    '{ "command": "echo test", "count": 9007199254740993 }\n',
  ]
  await page.evaluate(() => {
    window.dovoCopyText = async (text) => {
      window.copied = text
    }
  })
  for (const mode of ['desktop', 'mobile'])
    for (const payload of payloads) {
      await page.getByRole('textbox', { name: 'Draft', exact: true }).focus()
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload)
      await page.evaluate(({ mode, detail }) => window.show(mode, detail), { mode, detail })
      const toggle = page.getByRole('button', { name: 'Full JSON', exact: true })
      await toggle.waitFor()
      assert.equal(
        await page
          .getByRole('textbox', { name: 'Draft', exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      )
      if (mode === 'desktop') {
        if (payload.command) {
          const preview = page.getByRole('region', { name: 'Command', exact: true })
          assert.equal(await preview.textContent(), payload.command)
          await preview.focus()
          assert.equal(await preview.evaluate((el) => el === document.activeElement), true)
        }
        await toggle.click()
        assert.equal(await page.locator('[data-approval-json]').textContent(), detail)
      } else {
        await toggle.click()
        assert.equal((await page.locator('section span').allTextContents()).includes(detail), true)
      }
      await page.getByRole('button', { name: 'Copy Full JSON', exact: true }).click()
      await page.waitForFunction((detail) => window.copied === detail, detail)
      assert.equal(
        await page.getByRole('textbox', { name: 'Draft', exact: true }).inputValue(),
        'Keep my draft',
      )
      await page.evaluate(() => window.show('none', ''))
      await page.locator('section').waitFor({ state: 'detached' })
    }
  assert.deepEqual(errors, [])
  console.log(
    'Approval details: complete long commands, MCP arguments and resolved form actions pass on desktop/mobile. Mounting keeps composer focus and draft. Native views are fixtures.',
  )
} finally {
  await browser.close()
}
