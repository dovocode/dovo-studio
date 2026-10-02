import { build } from 'esbuild'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    contents: `
import {createRoot} from 'react-dom/client';import Usage from '../studio-shell/src/app-settings/usage.tsx';
createRoot(document.getElementById('app')).render(<Usage/>);`,
    resolveDir: root + 'packages/extension-tasks',
    loader: 'tsx',
  },
  plugins: [
    {
      name: 'usage-fixture',
      setup(builder) {
        builder.onResolve({ filter: /^@dovo\/studio-core$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }))
        builder.onResolve({ filter: /^\.\/reset-credits$/ }, ({ path }) => ({
          path,
          namespace: 'fixture',
        }))
        builder.onResolve({ filter: /^\.\/layout$/ }, () => ({
          path: root + 'packages/studio-ui/src/settings-layout.tsx',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === './reset-credits'
              ? 'export const ResetCredits=()=>null;'
              : `
export * from '@dovo/protocol';
const now=Date.now();
const turn=(id,age)=>({id,assistantId:id,agentId:'agent',provider:'codex',model:'gpt-6.1-sol',status:'completed',startedAt:new Date(now-age*86400000).toISOString(),finishedAt:new Date(now-age*86400000+60000).toISOString(),usageAccount:{id:'account',label:'Personal',subscription:'Pro'}});
const tasks=[{id:'task',title:'Improve composer',example:false,turns:[{...turn('recent',1),tokens:12000,estimatedCostUsd:.035},turn('partial',2),turn('older',20)]}];
const reading={provider:'codex',updatedAt:new Date(now).toISOString(),usedPercent:92,window:'5-hour',resetsAt:Math.floor(now/1000)+3600,account:{id:'account',label:'Personal',subscription:'Pro'}};
const runtimes=[{profile:{id:'mac',name:'Mac'},snapshot:{workspace:{tasks,planLimits:[reading,{...reading,window:'Weekly',usedPercent:40,resetsAt:Math.floor(now/1000)-10}]}}}];
export const useWorkspace=()=>({runtimes});`,
          resolveDir: root + 'packages/studio-shell',
          loader: 'js',
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  conditions: ['development'],
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<html class="dark"><body style="margin:0"><div id="app" style="height:100vh"></div></body></html>',
  )
  const assets = root + 'apps/web/dist/client/assets'
  for (const file of readdirSync(assets).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: readFileSync(assets + '/' + file, 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('Activity overview', { exact: true }).waitFor()
  await page.getByText('1 of 2 turns reported', { exact: true }).waitFor()
  if ((await page.getByRole('progressbar').count()) !== 1)
    throw new Error('Expired limits appeared as a live progress bar')
  await page.getByRole('radio', { name: 'Models', exact: true }).click()
  await page.getByText('Models by agent time', { exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Threads', exact: true }).click()
  await page.getByText('Improve composer', { exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Last 30 days', exact: true }).click()
  await page.getByText('1 of 3 turns reported', { exact: true }).waitFor()
  mkdirSync(root + 'work/usage-preview', { recursive: true })
  await page.screenshot({ path: root + 'work/usage-preview/desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: root + 'work/usage-preview/narrow.png', fullPage: true })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  if (overflow || errors.length) throw new Error(JSON.stringify({ overflow, errors }))
  console.log(
    'Usage cards, partial coverage, period and breakdown controls, expired quota readings, and narrow layout passed. Screenshots: work/usage-preview/.',
  )
} finally {
  await browser.close()
}
