import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const resolveDir = new URL('../apps/mobile/', import.meta.url).pathname
const controls = `
export const View=({children})=><div>{children}</div>;
export const ScrollView=View;
export const Pressable=({children,onPress,accessibilityLabel,accessibilityState})=><button aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected} onClick={onPress}>{children}</button>;
export const Text=({children})=><span>{children}</span>;
export const Field=({label,value,onChangeText,onSubmitEditing,maxLength,placeholder})=><input aria-label={label} value={value} maxLength={maxLength} placeholder={placeholder} onChange={event=>onChangeText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')onSubmitEditing?.()}}/>;
export const useTheme=()=>({styles:{row:{},muted:{}},colors:{}});
`
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {JiraQuickViews,JiraFilterFields} from './src/scm/work/jira-filters';
function App(){const [state,setState]=useState('all'),[filters,setFilters]=useState({});window.current={state,filters};
return <><JiraQuickViews state={state} filters={filters} onChange={(state,filters)=>{setState(state);setFilters(filters)}}/>
<JiraFilterFields state={state} filters={filters} onState={setState} onFilters={setFilters} issues={[{state:'In Review',priority:'High',type:'Bug',labels:['all','mobile']}]} /></>}
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  plugins: [
    {
      name: 'native-jira-controls',
      setup(builder) {
        const paths = new Set([
          'react-native',
          '../../ui/content/text',
          '../../ui/controls/field',
          '../../ui/theme',
        ])
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          paths.has(path) ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: controls,
          loader: 'tsx',
          resolveDir,
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByRole('button', { name: 'My issues', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.current))), {
    state: 'open',
    filters: { assignee: 'mine' },
  })
  await page.getByRole('button', { name: 'Done', exact: true }).first().click()
  assert.equal(await page.evaluate(() => window.current.state), 'closed')
  await page.getByRole('button', { name: 'In progress', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.current))), {
    state: 'all',
    filters: { assignee: 'all', statusCategory: 'in-progress' },
  })
  await page.getByRole('textbox', { name: 'Exact workflow status' }).fill('Awaiting approval')
  await page.getByRole('button', { name: 'Use Awaiting approval', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => JSON.parse(JSON.stringify(window.current))), {
    state: 'Awaiting approval',
    filters: { assignee: 'all' },
  })
  await page.getByRole('textbox', { name: 'Priority', exact: true }).fill('Urgent')
  await page.getByRole('textbox', { name: 'Priority', exact: true }).press('Enter')
  assert.equal(await page.evaluate(() => window.current.filters.priority), 'Urgent')
  await page.getByRole('button', { name: 'all', exact: true }).click()
  assert.equal(await page.evaluate(() => window.current.filters.label), 'all')
  await page.getByRole('button', { name: 'Clear label', exact: true }).click()
  assert.equal(await page.evaluate(() => window.current.filters.label), undefined)
  await page.getByRole('textbox', { name: 'Priority', exact: true }).fill('')
  await page.getByRole('button', { name: 'High', exact: true }).click()
  assert.equal(await page.evaluate(() => window.current.filters.priority), 'High')
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Jira views browser checks passed: quick views, categories, exact statuses, typed values, suggestions and clearing.',
  )
} finally {
  await browser.close()
}
