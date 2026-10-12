import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const screenshots = process.env.DOVO_REVIEW_SCREENSHOTS
const bundle = await build({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {CodeReviewReport} from '${root}/packages/extension-tasks/src/review/code-review-report.tsx';import {useTaskReview} from '${root}/packages/extension-tasks/src/review/use-task-review.ts';
const finding={id:'finding',path:'src/save.ts',line:42,severity:'high',title:'Missing await',trigger:'Save then close',impact:'Changes are lost',suggestion:'Await persistence',status:'open'};
const round={id:'round',taskId:'task',reviewer:'Reviewer',model:'model',createdAt:'2026-10-12',status:'completed',baseline:'tree',head:'head',directory:'/repo',files:[],findings:[finding],summary:'Inspected save and callers',notVerified:['Device restart']};
let report={reviews:[],commands:[{id:'cmd',command:'pnpm test',time:'2026-10-12',status:'failed',exitCode:1,output:'Save test failed',source:'author'},{id:'unknown',command:'pnpm lint',time:'2026-10-12',status:'unknown',output:'',source:'author'}],current:true,evidenceLimited:false};
window.reviewRequest=async(path,input)=>{window.requests.push({path,input});if(path.endsWith('/start')) report={...report,reviews:[round]};if(path.endsWith('/finding')) report={...report,reviews:[{...report.reviews[0],findings:[{...finding,status:input.status}]}]};if(path.endsWith('/fix')) report={...report,reviews:[{...round,findings:[{...finding,status:'addressed'}]}]};return structuredClone(report)};window.requests=[];window.verifiedFix=()=>{report={...report,reviews:[{...round,id:'followup',findings:[],verifiedFixes:[{findingId:'finding',command:'pnpm test save',evidence:'Awaited persistence; save regression passed'}]},round]};document.dispatchEvent(new Event('visibilitychange'))};
function App(){const [tab,setTab]=useState('diff');const review=useTaskReview('task','version');return <CodeReviewReport task={{id:'task',files:[{path:'src/save.ts'}],status:'review'}} review={review} tab={tab} onTab={setTab} onOpen={f=>window.opened=f} onSince={id=>window.since=id}/>};createRoot(document.getElementById('app')).render(<App/>);`,
    loader: 'tsx',
    resolveDir: root + '/packages/studio-ui',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
  },
  nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
  plugins: [
    {
      name: 'context',
      setup(b) {
        b.onResolve({ filter: /^@dovo\/studio-(core|ui)$/ }, ({ path }) => ({
          path,
          namespace: 'mock',
        }))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
          loader: 'tsx',
          resolveDir: root + '/packages/studio-ui',
          contents: path.endsWith('core')
            ? `const request=(...args)=>window.reviewRequest(...args);export const useWorkspace=()=>({workspace:{agents:[]},connected:true,activeRuntimeId:'runtime',request});`
            : screenshots
              ? `export {Button} from './src/components/ui/button';export {ChoicePicker} from './src/choice-picker';`
              : `export const Button=({size,variant,children,...props})=><button {...props}>{children}</button>;export const ChoicePicker=({onValueChange,children,...props})=><select {...props} onChange={e=>onValueChange(e.target.value)}>{children}</select>;`,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<body class="studio dark"><div id="app" style="height:100vh;display:flex;flex-direction:column"></div></body>',
  )
  if (screenshots) {
    await mkdir(screenshots, { recursive: true })
    for (const name of (await readdir(root + '/apps/desktop/dist/assets')).filter((name) =>
      name.endsWith('.css'),
    ))
      await page.addStyleTag({
        content: await readFile(root + '/apps/desktop/dist/assets/' + name, 'utf8'),
      })
    await page.addStyleTag({
      content:
        'body{margin:0;background:#101114;color:#eee}body:before{content:"Review UI · sample test data";display:block;padding:12px 16px;font:12px system-ui;color:#999;border-bottom:1px solid #333}#app{height:calc(100vh - 41px)!important}',
    })
  }
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('button', { name: 'Independent review', exact: true }).click()
  await page.getByText('Missing await', { exact: true }).waitFor()
  if (screenshots)
    await page.screenshot({ path: screenshots + '/review-desktop-findings.png', fullPage: true })
  await page.getByRole('button', { name: 'src/save.ts:42' }).click()
  assert.equal(await page.evaluate(() => window.opened.line), 42)
  await page.getByRole('button', { name: 'Ask author to fix', exact: true }).click()
  await page.getByText('Fix requested · needs re-review', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Resolve manually', exact: true }).click()
  await page.getByText('Resolved manually', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Reopen', exact: true }).click()
  await page.getByText('open', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Since last review' }).click()
  assert.equal(await page.evaluate(() => window.since), 'round')
  await page.getByRole('tab', { name: 'Verification', exact: true }).click()
  await page.getByText('Device restart', { exact: true }).waitFor()
  await page.getByText('Exit status unknown', { exact: true }).waitFor()
  await page.locator('summary').filter({ hasText: 'pnpm test' }).click()
  assert.equal(await page.getByText('Save test failed', { exact: true }).isVisible(), true)
  if (screenshots)
    await page.screenshot({
      path: screenshots + '/review-desktop-verification.png',
      fullPage: true,
    })
  await page.evaluate(() => window.verifiedFix())
  await page.getByRole('tab', { name: /Findings/ }).click()
  const verified = page.locator('details').filter({ hasText: 'Fix verified by reviewer' })
  await verified.locator('summary').click()
  await page.getByText('Awaited persistence; save regression passed', { exact: true }).waitFor()
  await page.getByText('pnpm test save · passed on reviewed revision', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'Code review: start, exact finding navigation, fix, resolve/reopen, since-review and failed/unknown verification passed',
  )
} finally {
  await browser.close()
}
