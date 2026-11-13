import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
async function bundle(mobile) {
  const controls = `export const View=({children})=><div>{children}</div>;export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SettingsField=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={!editable} onChange={e=>onChangeText(e.target.value)}/>;export const SettingsChoice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`
  const preference = `import {useState} from 'react';export function useAppPreferences(){const [source,setSource]=useState(window.source??'official');window.setSource=value=>{window.source=value;setSource(value)};return {mcpRegistrySource:source}};export const updateAppPreferences=value=>window.setSource(value.mcpRegistrySource);export const useMobilePreferences=useAppPreferences;export const updateMobilePreferences=updateAppPreferences;`
  const mocks = {
    '@dovo/studio-core': `export * from '@dovo/protocol';export const useWorkspace=()=>window.runtime;${preference}`,
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/studio-ui/resource-editors': `export {CatalogPicker} from '${root}/packages/studio-ui/src/resources/catalog-picker.tsx';export {resourceError} from '${root}/packages/studio-ui/src/resources/error.ts';`,
    '../runtime/preferences/app-preferences': preference,
    '../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
    '../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/client-runtime': `import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;`,
    '../ui/content/open-link': `export const useOpenAppLink=()=>url=>{window.links.push(url)};`,
    '../screens/settings-theme': `export const SettingsSheet=({children})=><section role="dialog">{children}</section>;export const useSettingsTheme=()=>({styles:{}});`,
    '../screens/settings-controls': controls,
    '../ui/content/text': controls,
    'react-native': controls,
  }
  const ui = `${root}/packages/studio-ui/src/components/ui`
  if (!mobile)
    mocks['@dovo/studio-ui'] =
      `export {Button} from '${ui}/button.tsx';export {Input} from '${ui}/input.tsx';export * from '${ui}/dialog.tsx';export * from '${ui}/select.tsx';`
  const source = mobile ? 'apps/mobile/src/resources' : 'packages/extension-agents/src/resources'
  const built = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
      import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';import {decode} from '@dovo/protocol';import {CatalogPicker} from '${root}/${source}/catalog-picker.tsx';
      window.calls=[];window.links=[];window.failGlama=true;
      const entry=(name,extra={})=>({name,description:'Description '+name,version:'1.0',url:'https://example.com/'+name,variants:[],...extra});
      const request=async(path,input,schema)=>{
        window.calls.push({path,input});let result;
        if(path.endsWith('/skills')) result={entries:[{id:'review',name:'Review',source:'owner/repo',url:'https://skills.sh/owner/repo/review',installs:120,installsPeriod:input.view==='trending'?'24h':'all-time',supported:true},{id:'audit',name:'Audit',source:'owner/repo',url:'https://skills.sh/owner/repo/audit',supported:true}],cursor:input.cursor?undefined:'1'};
        else if(input.source==='glama') {if(window.failGlama)throw Error('Set GLAMA_API_KEY on the host computer');result={entries:[entry('Glama docs',{provider:'glama',providerId:'team/docs',qualityScore:4.5,promoted:true,url:'https://glama.ai/mcp/servers/team/docs'})]}}
        else if(input.source==='smithery') result=input.server?{entries:[entry('Hosted docs',{provider:'smithery',providerId:'team/docs',variants:[{id:'http',label:'HTTP',notes:['Review authentication'],server:{name:'docs',enabled:true,transport:'http',url:'https://example.com/mcp',command:'',args:[],env:{},headerEnv:{},bearerTokenEnv:''}}]})]}:{entries:[entry('Hosted docs',{provider:'smithery',providerId:'team/docs',uses:240,verified:true})]};
        else if(window.delayOfficial) result=await new Promise(resolve=>window.resolveOfficial=()=>resolve({entries:[entry('Stale official result')]}));
        else result={entries:[entry('Zulu',{updatedAt:'2026-11-12T00:00:00Z'}),entry('Alpha',{updatedAt:'2026-11-13T00:00:00Z'})]};
        return decode(schema,window.legacyRuntime ? result : {...result, ...(path.endsWith('/skills') ? {view:input.view??'search'} : {source:input.source??'official'})})
      };
      window.runtime={request,call:request,callEffect:(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error})};
      function App(){const [kind,setKind]=useState('mcp');window.setKind=setKind;return <CatalogPicker key={kind} kind={kind} scope="This Bot" onClose={()=>{}} onServer={server=>window.imported=server} onSkill={()=>{}} onSelect={entry=>window.imported=entry.value} onSkills={async()=>{}}/>}
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      react: `${root}/packages/studio-ui/node_modules/react`,
      'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    },
    nodePaths: [`${root}/packages/studio-ui/node_modules`],
    plugins: [
      {
        name: 'boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents: mocks[path],
            loader: 'tsx',
            resolveDir: `${root}/packages/studio-ui`,
          }))
        },
      },
    ],
  })
  return built.outputFiles[0].text
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 900, height: 860 } })
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle(mobile) })
    const choice = async (label, value) => {
      if (mobile) await page.getByLabel(label, { exact: true }).selectOption(value)
      else {
        await page.getByRole('combobox', { name: label, exact: true }).click()
        await page.getByRole('option', { name: value, exact: true }).click()
      }
    }
    await page.getByText('Description Zulu', { exact: true }).waitFor()
    await choice('Sort loaded results', mobile ? 'name' : 'Name A–Z')
    assert.equal(
      await page
        .getByText('Alpha', { exact: true })
        .evaluate(
          (node) =>
            !!(
              node.compareDocumentPosition(
                [...document.querySelectorAll('*')].find(
                  (element) => element.textContent === 'Zulu' && !element.children.length,
                ),
              ) & Node.DOCUMENT_POSITION_FOLLOWING
            ),
        ),
      true,
    )
    await page.evaluate(() => (window.delayOfficial = true))
    await page.getByLabel('Search catalog', { exact: true }).fill('docs')
    await page.waitForFunction(() => typeof window.resolveOfficial === 'function')
    await choice('MCP registry source', mobile ? 'smithery' : 'Smithery')
    await page.getByText('240 uses on Smithery', { exact: true }).waitFor()
    await page.evaluate(() => window.resolveOfficial())
    assert.equal(await page.getByText('Stale official result', { exact: true }).count(), 0)
    await page.getByText('Verified by Smithery · Not a security audit', { exact: true }).waitFor()
    await page.getByRole('button', { name: mobile ? 'View Hosted docs' : /Hosted docs/ }).click()
    await page.getByRole('button', { name: 'Configure server', exact: true }).click()
    await page.waitForFunction(() => window.imported?.url === 'https://example.com/mcp')
    await page
      .getByRole('button', { name: mobile ? 'Search results' : 'Back to results', exact: true })
      .click()
    await choice('MCP registry source', mobile ? 'glama' : 'Glama')
    await page.getByText('Set GLAMA_API_KEY on the host computer', { exact: true }).waitFor()
    await page.evaluate(() => {
      window.failGlama = false
    })
    await page.getByRole('button', { name: 'Retry catalog', exact: true }).click()
    await page
      .getByText('Glama tool quality: 4.5/5 · Not a safety score', { exact: true })
      .waitFor()
    await page.getByText('Promoted on Glama', { exact: true }).waitFor()
    if (mobile) {
      await page.getByRole('button', { name: 'View on Glama', exact: true }).click()
      assert.equal(
        await page.evaluate(() => window.links.at(-1)),
        'https://glama.ai/mcp/servers/team/docs',
      )
    } else
      assert.equal(
        await page.getByRole('link', { name: 'View on Glama', exact: true }).getAttribute('href'),
        'https://glama.ai/mcp/servers/team/docs',
      )
    await page.evaluate(() => window.setKind('skill'))
    await choice('Browse skills', mobile ? 'trending' : 'Trending (24h)')
    await page
      .getByText(mobile ? 'owner/repo · 120 installs in 24h' : '120 installs in 24h', {
        exact: true,
      })
      .waitFor()
    await choice('Sort loaded results', mobile ? 'installs' : 'Most installs')
    await page.getByRole('button', { name: 'Load more', exact: true }).click()
    await page.waitForFunction(() =>
      window.calls.some((call) => call.input.view === 'trending' && call.input.cursor === '1'),
    )
    await page
      .getByText(mobile ? 'owner/repo · Install count unavailable' : 'Install count unavailable', {
        exact: true,
      })
      .waitFor()
    await page.evaluate(() => {
      window.legacyRuntime = true
      window.setKind('mcp')
    })
    await page
      .getByText('Update this computer’s runtime to use this MCP registry.', { exact: true })
      .waitFor()
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Catalogs: desktop/mobile source switching, stale responses, usage, quality, promotion, attribution, host setup, reviewed configuration and skills browsing pass.',
  )
} finally {
  await browser.close()
}
