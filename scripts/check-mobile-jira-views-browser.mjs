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
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const Choice=({label,value,onChange,items,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const useTheme=()=>({styles:{row:{},muted:{}},colors:{}});
`
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {JiraBrowseControls} from './src/scm/work/jira-browse-controls';
import {Effect} from 'effect';import {decode} from '@dovo/protocol';
import {JiraQuickViews,JiraFilterFields} from './src/scm/work/jira-filters';
window.metadataReads=[];const cache={readEffect:()=>Effect.succeed(null),writeEffect:()=>Effect.void};
window.runtime={cacheForRuntime:()=>cache,readRuntimeEffect:(profile,path,input,schema)=>Effect.tryPromise({try:async()=>{window.metadataReads.push({path,input});if(path==='/api/scm/source/identity')return decode(schema,{readerIdentity:'account',destination:'dest'});if(window.metadataFailure)throw Error('Metadata unavailable');return decode(schema,path.endsWith('/boards')?{boards:[{id:'104',name:'Delivery',type:'scrum'},{id:'105',name:'Support',type:'kanban'}],truncated:false}:{board:input.id,sprints:input.id==='104'?[{id:'176',name:'Sprint 2',state:'active'}]:[],truncated:false})},catch:error=>error})};
const source={kind:'jira',key:'team',profile:{id:'runtime',connection:{address:'http://runtime',token:'token'}},jiraSource:{id:'team',site:'https://team.atlassian.net',project:'TEAM'},connected:true};
function App(){const [state,setState]=useState('all'),[filters,setFilters]=useState({});window.current={state,filters};
return <><JiraQuickViews state={state} filters={filters} onChange={(state,filters)=>{setState(state);setFilters(filters)}}/>
<JiraBrowseControls source={source} filters={filters} onFilters={setFilters} enabled={true}/><JiraFilterFields state={state} filters={filters} onState={setState} onFilters={setFilters} issues={[{state:'In Review',priority:'High',type:'Bug',labels:['all','mobile']}]} /></>}
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
          '../../ui/controls/action',
          '../../ui/controls/choice',
        ])
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          ['../../runtime/connection/provider', '../runtime/connection/provider'].includes(path)
            ? { path, namespace: 'runtime' }
            : paths.has(path)
              ? { path, namespace: 'mock' }
              : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'runtime' }, () => ({
          contents: 'export const useRuntime=()=>window.runtime;',
          loader: 'tsx',
        }))
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
  await page.getByLabel('Saved Jira board', { exact: true }).selectOption('104')
  await page.getByLabel('Jira sprint', { exact: true }).selectOption('176')
  assert.equal(await page.evaluate(() => window.current.filters.sprint), '176')
  await page.getByLabel('Saved Jira board', { exact: true }).selectOption('105')
  assert.equal(await page.evaluate(() => window.current.filters.sprint), undefined)
  await page.getByRole('textbox', { name: 'Team ID', exact: true }).fill('team-uuid')
  await page.getByRole('textbox', { name: 'Team ID', exact: true }).press('Enter')
  assert.equal(await page.evaluate(() => window.current.filters.team), 'team-uuid')
  await page.getByRole('textbox', { name: 'Component', exact: true }).fill('API')
  await page.getByRole('textbox', { name: 'Component', exact: true }).press('Enter')
  await page.getByRole('textbox', { name: 'Release', exact: true }).fill('v2')
  await page.getByRole('textbox', { name: 'Release', exact: true }).press('Enter')
  assert.equal(await page.evaluate(() => window.current.filters.release), 'v2')
  await page.evaluate(() => (window.metadataFailure = true))
  await page.getByRole('button', { name: 'Refresh board choices', exact: true }).click()
  await page.getByRole('button', { name: 'Retry boards', exact: true }).waitFor()
  await page.evaluate(() => (window.metadataFailure = false))
  await page.getByRole('button', { name: 'Retry boards', exact: true }).click()
  await page.getByRole('button', { name: 'Retry boards', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(() =>
      window.metadataReads.some(
        (read) =>
          read.path.endsWith('/boards') &&
          read.input.refresh &&
          read.input.expectedDestination === 'dest',
      ),
    ),
    true,
  )
  assert.deepEqual(errors, [])
  console.log(
    'Mobile Jira views browser checks passed: quick views, categories, exact statuses, typed values, suggestions and clearing.',
  )
} finally {
  await browser.close()
}
