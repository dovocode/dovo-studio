import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'
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
        builder.onResolve({ filter: /^@dovo\/studio-ui$/ }, () => ({
          path: 'usage-ui',
          namespace: 'fixture',
        }))
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
            path === 'usage-ui'
              ? `export {Button} from '${root}packages/studio-ui/src/components/ui/button.tsx';export {Input} from '${root}packages/studio-ui/src/components/ui/input.tsx';export * from '${root}packages/studio-ui/src/components/ui/select.tsx';export {ChoicePicker} from '${root}packages/studio-ui/src/choice-picker.tsx';`
              : path === './reset-credits'
                ? 'export const ResetCredits=()=>null;'
                : `
import {useSyncExternalStore} from 'react';
export * from '@dovo/protocol';
const now=Date.now();
const turn=(id,age)=>({id,assistantId:id,agentId:'agent',provider:'codex',model:'gpt-6.1-sol',status:'completed',startedAt:new Date(now-age*86400000).toISOString(),finishedAt:new Date(now-age*86400000+60000).toISOString(),usageAccount:{id:'account',label:'Personal',subscription:'Pro'}});
const tasks=[{id:'task',title:'Improve composer',example:false,turns:[{...turn('recent',1),tokens:12000,estimatedCostUsd:.035},turn('partial',2),turn('older',20)]}];
const reading={provider:'codex',updatedAt:new Date(now).toISOString(),usedPercent:92,window:'5-hour',resetsAt:Math.floor(now/1000)+3600,account:{id:'account',label:'Personal',subscription:'Pro'}};
const initialRuntimes=[{connected:true,profile:{id:'mac',name:'Mac',connection:{address:'http://runtime',token:'test-token'}},snapshot:{workspace:{tasks,planLimits:[reading,{...reading,window:'Weekly',usedPercent:40,resetsAt:Math.floor(now/1000)-10}]}}}];
let runtimes=initialRuntimes;
const cache={read:async()=>null,write:async()=>{}};
window.usageProbes=0;window.usageWrites=[];
const readRuntime=async(profile,path,input)=>{if(path==='/api/usage/limits/read'){window.usageProbes++;return {checkedAt:new Date().toISOString(),accounts:[{agentId:'agent',provider:'codex',status:'ok'}]}};if(path==='/api/usage/prices/write'){window.usageWrites.push(input);return {ok:true}};return {sourceId:'stable',records:[],notices:[]}};
const listeners=new Set();const subscribe=callback=>{listeners.add(callback);return ()=>listeners.delete(callback)};
window.changeUsageScenario=scenario=>{runtimes=scenario==='unpaired'?[]:initialRuntimes.map(entry=>({...entry,snapshot:{workspace:{tasks:scenario==='empty'?[]:scenario==='zero'?[{...tasks[0],turns:[{...turn('zero',1),tokens:0,estimatedCostUsd:0}]}]:scenario==='missing'?[{...tasks[0],turns:[turn('missing',1)]}]:tasks,planLimits:[]}}}));listeners.forEach(callback=>callback())};
export const useWorkspace=()=>{useSyncExternalStore(subscribe,()=>runtimes);return {runtimes,readRuntime,refreshRuntime:async()=>{},runtimeReadCache:()=>cache}};`,
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
  const assets = root + 'apps/desktop/dist/assets'
  for (const file of readdirSync(assets).filter((file) => file.endsWith('.css')))
    await page.addStyleTag({ content: readFileSync(assets + '/' + file, 'utf8') })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('Activity overview', { exact: true }).waitFor()
  await page.getByText('1 of 2 turns reported', { exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Limits', exact: true }).click()
  if ((await page.getByRole('progressbar').count()) !== 1)
    throw new Error('Expired limits appeared as a live progress bar')
  await page.getByRole('radio', { name: 'Costs', exact: true }).click()
  await page.getByRole('radio', { name: 'Models', exact: true }).click()
  await page.getByText('Models by agent time', { exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Threads', exact: true }).click()
  await page.getByText('Improve composer', { exact: true }).waitFor()
  await page.getByRole('combobox', { name: 'Period', exact: true }).click()
  await page.getByRole('option', { name: 'Last 30 days', exact: true }).click()
  await page.getByText('1 of 3 turns reported', { exact: true }).waitFor()
  await page.getByRole('combobox', { name: 'Period', exact: true }).click()
  await page.getByRole('option', { name: 'Last 90 days', exact: true }).click()
  for (const [width, scale] of [
    [320, 1],
    [390, 1],
    [768, 1],
    [1100, 1],
    [390, 2],
    [768, 2],
  ]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(
      (scale) => (document.documentElement.style.fontSize = 16 * scale + 'px'),
      scale,
    )
    const bars = page.getByRole('region', { name: 'Daily usage', exact: true }).getByRole('img')
    assert.ok((await bars.count()) >= 90)
    assert.equal(
      await bars.evaluateAll((nodes) =>
        nodes.every((node) => node.getBoundingClientRect().width >= 1),
      ),
      true,
      'Quarterly chart keeps visible bars at ' + width,
    )
    assert.equal(
      await bars.evaluateAll((nodes) =>
        nodes.every((node) => {
          const box = node.getBoundingClientRect(),
            parent = node.parentElement.getBoundingClientRect()
          return box.left >= parent.left && box.right <= parent.right
        }),
      ),
      true,
      'Quarterly bars stay inside the chart at ' + width,
    )
  }
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.evaluate(() => (document.documentElement.style.fontSize = ''))
  await page.getByText('Custom API-equivalent prices', { exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Input', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: 'Output', exact: true }).fill('10')
  await page.getByRole('button', { name: 'Save prices', exact: true }).click()
  await page.waitForFunction(() => window.usageWrites.length === 1)
  const write = await page.evaluate(() => window.usageWrites[0])
  if (write.model !== 'gpt-6.1-sol' || write.price.cacheRead !== 2)
    throw new Error('Custom prices did not preserve the exact model ID and default cache rate')
  mkdirSync(root + 'work/usage-preview', { recursive: true })
  await page.screenshot({ path: root + 'work/usage-preview/desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: root + 'work/usage-preview/narrow.png', fullPage: true })
  await page.getByRole('radio', { name: 'Tokens', exact: true }).click()
  const chart = page.getByRole('region', { name: 'Daily usage', exact: true })
  assert.ok(
    (await chart.getByRole('img', { name: /Tokens not reported/ }).count()) > 0,
    'Missing token reports must not be labeled zero',
  )
  await page.evaluate(() => window.changeUsageScenario('missing'))
  await chart
    .getByRole('status')
    .filter({ hasText: 'No tokens reported in this period.' })
    .waitFor()
  assert.equal(await chart.getByRole('img').count(), 0)
  await page.getByRole('radio', { name: 'Costs', exact: true }).click()
  await chart.getByRole('status').filter({ hasText: 'No priced usage in this period.' }).waitFor()
  await page.evaluate(() => window.changeUsageScenario('zero'))
  await chart
    .getByRole('status')
    .filter({ hasText: 'Reported cost is $0.00 in this period.' })
    .waitFor()
  await page.getByRole('radio', { name: 'Tokens', exact: true }).click()
  await chart
    .getByRole('status')
    .filter({ hasText: 'Reported token usage is zero in this period.' })
    .waitFor()
  await page.evaluate(() => window.changeUsageScenario('empty'))
  await chart.getByRole('status').filter({ hasText: 'No usage in this period.' }).waitFor()
  assert.equal(
    await chart.getByRole('img').count(),
    0,
    'Empty chart has no invisible bars beside its message',
  )
  const message = await chart.getByRole('status').boundingBox()
  const chartBox = await chart.boundingBox()
  assert.ok(
    Math.abs(message.x + message.width / 2 - chartBox.x - chartBox.width / 2) < 1,
    'Empty chart message is centered',
  )
  await page.getByRole('radio', { name: 'Limits', exact: true }).click()
  await page.getByText(/No account limits reported/).waitFor()
  await page.evaluate(() => window.changeUsageScenario('unpaired'))
  await page
    .getByText('Connect a computer to see recorded usage and account limits.', { exact: true })
    .waitFor()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  if (overflow || errors.length) throw new Error(JSON.stringify({ overflow, errors }))
  console.log(
    'Usage cards, partial coverage, period and breakdown controls, expired quota readings, and quarterly narrow charts, missing-report and empty states passed. Screenshots: work/usage-preview/.',
  )
} finally {
  await browser.close()
}
