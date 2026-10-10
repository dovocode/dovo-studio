import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
const built = await build({
  stdin: {
    contents: `
import { createRoot } from 'react-dom/client';
import { PullStack } from '../extension-scm/src/pulls/detail/stack.tsx';
import { pullStacks } from '@dovo/protocol';
const parent={number:1,title:'Base change',url:'https://github.com/test/repo/pull/1',state:'open',draft:false,head:'test:parent',base:'test:main',author:'test',updatedAt:'2026-10-02',labels:[]};
const child={...parent,number:2,title:'Dependent change',url:'https://github.com/test/repo/pull/2',head:'test:child',base:'test:parent'};
const root=createRoot(document.getElementById('app'));
window.actions=[];
window.show=(connected=true,complete=true)=>root.render(<PullStack detail={{pull:child,stack:pullStacks([parent,child],complete).get(2)}} connected={connected} onSelect={number=>window.actions.push(number)} onCreate={()=>window.actions.push('create')} onUpdate={()=>window.actions.push('update')}/>);
window.show();
`,
    resolveDir: fileURLToPath(new URL('../packages/studio-ui/', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'empty' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('Stack 2/2', { exact: true }).waitFor()
  const rows = await page.locator('ol li').allTextContents()
  if (!rows[0].includes('#1') || !rows[1].includes('on #1'))
    throw new Error('Missing ordered dependency: ' + rows)
  await page.getByRole('button', { name: /Base change/ }).click()
  await page.getByRole('button', { name: 'Stack a PR', exact: true }).click()
  await page.getByRole('button', { name: 'Ask agent to update stack', exact: true }).click()
  if (JSON.stringify(await page.evaluate(() => window.actions)) !== '[1,"create","update"]')
    throw new Error('Stack actions failed')
  await page.evaluate(() => window.show(false, false))
  await page.getByText('Stack · partial', { exact: true }).waitFor()
  if (
    !(await page
      .getByRole('button', { name: 'Ask agent to update stack', exact: true })
      .isDisabled())
  )
    throw new Error('Offline update enabled')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(
    'Stack order, dependency labels, navigation, create/update actions and offline/partial states verified.',
  )
} finally {
  await browser.close()
}
