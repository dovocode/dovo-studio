import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const ui = root + '/packages/studio-ui/src'
const native = `export const View=({children})=><div>{children}</div>;export const ScrollView=View;`
const state = `export {useState as useApplicationState} from 'react';`
const mocks = {
  '@dovo/studio-core': `const request=(...args)=>window.request(...args);export const useWorkspace=()=>({request,connected:true,activeRuntimeId:window.owner,connection:{address:'http://runtime.local',token:window.owner}});export {responses} from '@dovo/protocol';`,
  '@dovo/studio-core/state': state,
  '../../runtime/connection/provider': `const call=(...args)=>window.request(...args);export const useRuntime=()=>({call,read:call,connected:true,connection:{address:'http://runtime.local',token:window.owner}});`,
  '@dovo/studio-ui': `export * from '${ui}/components/ui/button.tsx';export * from '${ui}/components/ui/input.tsx';export * from '${ui}/components/ui/select.tsx';export * from '${ui}/components/ui/dialog.tsx';`,
  'react-native': native,
  '../ui/controls/field': `export const Field=({label,value,onChangeText,editable,placeholder})=><label>{label}<input aria-label={label} value={value} placeholder={placeholder} disabled={editable===false} onChange={e=>onChangeText(e.target.value)}/></label>;`,
  '../ui/controls/choice': `export const Choice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
  '../ui/controls/action': `export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;`,
  '../ui/content/text': `export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;`,
  '../ui/theme': `export const useTheme=()=>({styles:{}});`,
  '../../ui/layout/sheet': `export const Sheet=({title,children,onClose})=><div role="dialog" aria-label={title}><button onClick={onClose}>Close</button>{children}</div>;`,
}
for (const path of ['controls/action', 'content/text', 'theme'])
  mocks['../../ui/' + path] = mocks['../ui/' + path]
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const built = await build({
      stdin: {
        resolveDir: root + '/packages/studio-ui',
        loader: 'tsx',
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {SecretEnvironmentEditor} from '${root}/${mobile ? 'apps/mobile/src/agents' : 'packages/extension-agents/src'}/secret-environment-editor.tsx';
import {LocalCommitPicker} from '${root}/${mobile ? 'apps/mobile/src/tasks/detail' : 'packages/extension-tasks/src/review'}/local-commit-picker.tsx';
window.owner='owner-a';window.requests=[];window.refreshes=0;window.pending=[];
const first={sha:'a'.repeat(40),subject:'First commit',author:'Developer',date:'2026-10-30T12:00:00Z',parents:['b'.repeat(40)]};
window.request=async(path,input)=>{window.requests.push({path,input});if(window.hold){return new Promise(resolve=>window.pending.push(resolve))}if(window.fail)throw Error('Commit list unavailable');return {commits:[{...first,sha:input.sha?'c'.repeat(40):first.sha,subject:input.sha?'Older commit':window.owner==='owner-a'?'First commit':'Other owner commit'}],hasMore:!input.sha}};
function App(){const[refs,setRefs]=useState({}),[phase,setPhase]=useState('secrets'),[owner,setOwner]=useState(window.owner),[selected,setSelected]=useState('');window.currentRefs=refs;window.switchOwner=()=>{window.owner='owner-b';setOwner('owner-b')};return <main><button onClick={()=>setPhase('commits')}>Commit fixture</button>{phase==='secrets'?<SecretEnvironmentEditor value={refs} onChange={setRefs} onRefresh={async()=>{window.refreshes++}}/>:<><LocalCommitPicker taskId="task" onSelect={commit=>setSelected(commit.sha)}/><output aria-label="Selected commit">{selected}</output></>}</main>};createRoot(document.getElementById('app')).render(<App/>);`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      alias: {
        react: root + '/packages/studio-ui/node_modules/react',
        '@dovo/protocol': root + '/packages/protocol/src/index.ts',
      },
      nodePaths: [root + '/packages/studio-ui/node_modules', root + '/node_modules'],
      plugins: [
        {
          name: 'boundaries',
          setup(b) {
            b.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
            )
            b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: root + '/packages/studio-ui',
            }))
          },
        },
      ],
    })
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1100, height: 900 } }),
      errors = []
    page.setDefaultTimeout(10000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page
      .getByRole('textbox', { name: 'New secret environment variable', exact: true })
      .fill('API_KEY')
    await page.getByRole('button', { name: 'Add reference', exact: true }).click()
    if (mobile)
      await page
        .getByRole('combobox', { name: 'Secret provider for API_KEY' })
        .selectOption('infisical')
    else {
      await page.getByRole('combobox', { name: 'Secret provider for API_KEY' }).click()
      await page.getByRole('option', { name: 'Infisical', exact: true }).click()
    }
    for (const [label, value] of [
      ['Secret reference', 'SERVICE_KEY'],
      ['Infisical project', 'project-id'],
      ['Infisical environment', 'production'],
      ['Infisical path', '/backend'],
      ['Infisical domain', 'https://eu.infisical.com/api'],
    ])
      await page.getByRole('textbox', { name: label + ' for API_KEY', exact: true }).fill(value)
    assert.deepEqual(await page.evaluate(() => window.currentRefs), {
      API_KEY: {
        provider: 'infisical',
        reference: 'SERVICE_KEY',
        projectId: 'project-id',
        environment: 'production',
        path: '/backend',
        domain: 'https://eu.infisical.com/api',
      },
    })
    await page.getByRole('button', { name: 'Refresh secret references', exact: true }).click()
    await page.waitForFunction(() => window.refreshes === 1)
    await page
      .getByRole('textbox', { name: 'New secret environment variable', exact: true })
      .fill('API_KEY')
    await page.getByRole('button', { name: 'Add reference', exact: true }).click()
    assert.match(await page.getByRole('alert').innerText(), /unique/)
    await page.getByRole('button', { name: 'Commit fixture', exact: true }).click()
    await page.getByRole('button', { name: 'Local commits', exact: true }).click()
    await page.getByRole('button', { name: /First commit/ }).waitFor()
    await page.getByRole('button', { name: 'Older commits', exact: true }).click()
    await page.getByRole('button', { name: /Older commit/ }).click()
    assert.equal(await page.getByLabel('Selected commit').innerText(), 'c'.repeat(40))
    assert.equal(
      await page.evaluate(() => window.requests.some((r) => r.input.sha === 'b'.repeat(40))),
      true,
    )
    await page.evaluate(() => {
      window.hold = true
    })
    await page.getByRole('button', { name: 'Local commits', exact: true }).click()
    await page.waitForFunction(() => window.pending.length === 1)
    await page.evaluate(() => {
      window.hold = false
      window.switchOwner()
    })
    await page.getByRole('button', { name: /Other owner commit/ }).waitFor()
    await page.evaluate(() =>
      window.pending[0]({
        commits: [
          {
            sha: 'd'.repeat(40),
            subject: 'STALE OWNER DATA',
            author: 'Old',
            date: '2026-10-30',
            parents: [],
          },
        ],
        hasMore: false,
      }),
    )
    assert.equal(await page.getByText('STALE OWNER DATA').count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'T3 adoption UI checks passed: desktop/mobile Infisical references, refresh, duplicate protection, local commit selection/paging and credential isolation.',
  )
} finally {
  await browser.close()
}
