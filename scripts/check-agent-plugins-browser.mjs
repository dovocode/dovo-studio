// Renders the production agent plugin, MCP OAuth and plugin activation views on desktop/web and
// mobile, with an in-memory runtime behind the request boundary.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const output = process.env.SCREENSHOT_DIR
if (output) mkdirSync(output, { recursive: true })

/** The runtime contract the views use, with the same state rules as the runtime service. */
const runtime = `
import {decode} from '@dovo/protocol'
const revision='a'.repeat(40)
const plugins={formatter:{name:'formatter',description:'Formats code',version:'1.2.0',path:'plugins/formatter'},remote:{name:'remote',unsupported:'The github source type is not supported. Use a folder.'}}
const components={skills:['tidy'],commands:['format'],agents:[],hooks:true,mcpServers:['lint']}
const state={marketplaces:[],plugins:[]}
let oauth={connected:false,flow:undefined}
window.calls=[]
export async function request(path,input,schema){
  window.calls.push({path,input:structuredClone(input)})
  let result
  if(path==='/api/agents/plugins'){
    const marketplace=state.marketplaces[0]
    if(input.action==='list') result=state
    else if(input.action==='add-marketplace'){ if(!marketplace) state.marketplaces.push({id:'gh-0123456789ab',repository:'team/tools',revision,name:'Team tools',addedAt:'2026-11-25T10:00:00Z'}); result=state }
    else if(input.action==='catalog') result={marketplace,formats:['claude','codex'],plugins:Object.values(plugins)}
    else if(input.action==='preview') result={marketplaceId:marketplace.id,repository:marketplace.repository,revision,plugin:plugins[input.plugin],components,files:5,bytes:2048}
    else if(input.action==='install'){ const id=input.plugin+'@'+input.marketplaceId+':'+input.harness; state.plugins=[...state.plugins.filter(p=>p.id!==id),{id,marketplaceId:input.marketplaceId,repository:'team/tools',revision,name:input.plugin,version:'1.2.0',harness:input.harness,enabled:input.enabled,components,installedAt:'2026-11-25T10:00:00Z'}]; result=state }
    else if(input.action==='set-enabled'){ state.plugins=state.plugins.map(p=>p.id===input.id?{...p,enabled:input.enabled}:p); result=state }
    else if(input.action==='remove'){ state.plugins=state.plugins.filter(p=>p.id!==input.id); result=state }
  } else if(path==='/api/agents/mcp/oauth'){
    if(input.action==='status') result={statuses:input.servers.map(s=>({name:s.name,url:s.url,state:oauth.connected?'connected':'disconnected',refreshable:oauth.connected}))}
    else if(input.action==='connect'){ oauth.flow='flow-1'; result={flowId:'flow-1',authorizationUrl:'https://auth.example/authorize?state=s',redirectUri:'http://127.0.0.1:43123/callback',expiresAt:'2026-11-25T10:10:00Z'} }
    else if(input.action==='flow') result={flowId:input.flowId,state:'pending'}
    else if(input.action==='complete'){ if(!input.callbackUrl.includes('state=s')) throw new Error('This address belongs to a different sign-in'); oauth={connected:true}; result={flowId:input.flowId,state:'connected'} }
    else if(input.action==='disconnect'){ oauth={connected:false}; result={revoked:true} }
  } else if(path==='/api/agents/settings/save'){ window.saved=input.after; result={value:input.after,inherited:{}} }
  if(result===undefined) throw new Error('Unexpected '+path)
  return decode(schema,structuredClone(result))
}`

const desktopControls = `import {cloneElement,isValidElement} from 'react';export const Button=({children,variant,size,...props})=><button {...props}>{children}</button>;export const Input=props=><input {...props}/>;export const FormField=({label,children})=><label>{label}{isValidElement(children)?cloneElement(children,{'aria-label':label}):children}</label>;`
const mobileControls = `export const View=({children,style})=><div style={style}>{children}</div>;export const Text=({children,accessibilityRole})=><div role={accessibilityRole}>{children}</div>;export const Linking={openURL:async url=>{window.opened=url}};export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;export const SettingsAction=Action;export const Choice=({label,value,items,onChange,disabled})=><label>{label}<select aria-label={label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;export const SettingsChoice=Choice;export const Field=({label,value,onChangeText,editable,placeholder})=><label>{label}<input aria-label={label} placeholder={placeholder} disabled={editable===false} value={value} onChange={e=>onChangeText(e.target.value)}/></label>;export const SettingsField=Field;export const useTheme=()=>({colors:{surface:'#222',error:'#f88',accent:'#9cf'},styles:{card:{},muted:{}}});export const useSettingsTheme=useTheme;`

async function bundle(mobile) {
  const views = mobile
    ? `import {AgentPlugins} from '${root}/apps/mobile/src/screens/agent-plugins.tsx';import {McpOAuthSection as OAuth} from '${root}/apps/mobile/src/resources/mcp-oauth.tsx';import {PluginActivations} from '${root}/apps/mobile/src/resources/plugin-activations.tsx';`
    : `import {AgentPlugins} from '${root}/packages/extension-tasks/src/studio-extensions/agent-plugins.tsx';import {McpOAuthPanel as OAuth} from '${root}/packages/studio-ui/src/resources/mcp-oauth.tsx';import {PluginActivations} from '${root}/packages/extension-agents/src/resources/plugin-activations.tsx';`
  const workspace = `import {request} from 'runtime';const snapshot={harnessPluginsSupported:true,mcpOAuthSupported:true,runtimeHost:'build-box'};const value={request,call:request,connected:true,snapshot,runtimes:[],overviews:[],activeRuntimeId:'local',activeId:'local'};export const useWorkspace=()=>value;export const useRuntime=()=>value;`
  const stubs = {
    runtime,
    '@dovo/studio-core': workspace,
    '../runtime/connection/provider': workspace,
    '@dovo/studio-ui': desktopControls,
    'react-native': mobileControls,
    '../ui/controls/action': mobileControls,
    '../ui/controls/choice': mobileControls,
    '../ui/controls/field': mobileControls,
    '../ui/content/text': mobileControls,
    '../ui/theme': mobileControls,
    '../screens/settings-controls': mobileControls,
    '../screens/settings-theme': mobileControls,
  }
  const built = await build({
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `${views}
import {createRoot} from 'react-dom/client';import {useState} from 'react'
function Activations(){const [resources,setResources]=useState({mcpServers:[],skills:[]});return <PluginActivations settings={resources} resources={resources} inherited={{mcpServers:[],skills:[]}} scopeLabel="Platform organization" disabled={false} change={async update=>{const next=update(resources);window.saved=next;setResources(next)}} save={async update=>{const next=update(resources);window.saved=next;setResources(next)}}/>}
function Server(){const [server,setServer]=useState({name:'tracker',enabled:true,transport:'http',command:'',args:[],url:'https://tracker.example/mcp',env:{},headerEnv:{},bearerTokenEnv:''});window.server=server;return <OAuth draft={server} server={server} onChange={setServer} disabled={false}/>}
function App(){const [view,setView]=useState('plugins');window.show=setView;return view==='plugins'?<AgentPlugins/>:view==='oauth'?<Server/>:<Activations/>}
createRoot(document.getElementById('app')).render(<App/>)`,
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
            Object.hasOwn(stubs, path) ? { path, namespace: 'stub' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            contents: stubs[path],
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
    const name = mobile ? 'mobile' : 'desktop'
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 1400 } : { width: 1100, height: 1200 },
    })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('popup', (popup) => void popup.close())
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle(mobile) })
    const calls = (action) =>
      page.evaluate((action) => window.calls.filter((call) => call.input.action === action), action)

    // Add a marketplace, browse it, and review a plugin before installing it.
    if (!mobile) await page.getByText('Agent plugins', { exact: true }).click()
    await page.getByLabel('GitHub repository').fill('team/tools')
    await page.getByRole('button', { name: 'Add marketplace' }).click()
    await page.getByRole('button', { name: 'Browse plugins' }).click()
    await page
      .getByText('Unavailable: The github source type is not supported. Use a folder.')
      .waitFor()
    await page.getByRole('button', { name: mobile ? 'Review formatter' : 'Review' }).click()
    await page.getByText('Hooks: yes. Hooks run shell commands during agent work.').waitFor()
    await page
      .getByText('MCP servers: lint. These start processes or connect to services.')
      .waitFor()
    // Reviewing installs nothing.
    assert.equal((await calls('install')).length, 0)
    if (output)
      await page.screenshot({ path: `${output}/${name}-plugin-review.png`, fullPage: true })

    // Installation is separate from activation: the default installs without turning it on.
    await page.getByRole('button', { name: 'Install for Claude Code' }).click()
    await page
      .getByText('on only where a project or organization turns it on', { exact: false })
      .waitFor()
    const [install] = await calls('install')
    assert.deepEqual(install.input, {
      action: 'install',
      marketplaceId: 'gh-0123456789ab',
      plugin: 'formatter',
      revision: 'a'.repeat(40),
      harness: 'claude',
      enabled: false,
    })
    const on = mobile ? 'Turn on formatter for all projects' : 'Turn on for all projects'
    const off = mobile ? 'Turn off formatter for all projects' : 'Turn off for all projects'
    await page.getByRole('button', { name: on, exact: true }).click()
    await page.getByRole('button', { name: off, exact: true }).click()
    await page.getByRole('button', { name: on, exact: true }).waitFor()
    if (output)
      await page.screenshot({ path: `${output}/${name}-plugins-installed.png`, fullPage: true })
    await page
      .getByRole('button', { name: mobile ? 'Remove formatter' : 'Remove', exact: true })
      .click()
    await page.getByRole('button', { name: on, exact: true }).waitFor({ state: 'detached' })

    // Group activation: On, then Inherit removes the choice with an explicit empty list.
    await page.evaluate(() => window.show('activations'))
    await page.getByText('No plugins installed on this computer.').waitFor()
    await page.evaluate(() => window.show('plugins'))
    if (!mobile) await page.getByText('Agent plugins', { exact: true }).click()
    await page.getByRole('button', { name: 'Browse plugins' }).click()
    await page.getByRole('button', { name: mobile ? 'Review formatter' : 'Review' }).click()
    await page.getByRole('button', { name: 'Install for Claude Code' }).click()
    await page.evaluate(() => window.show('activations'))
    const choice = mobile
      ? page.getByLabel(/^formatter · Claude Code · now off$/)
      : page.getByLabel('formatter for Platform organization')
    await choice.selectOption('on')
    assert.deepEqual(await page.evaluate(() => window.saved.plugins), [
      { name: 'formatter@gh-0123456789ab:claude', enabled: true },
    ])
    if (output)
      await page.screenshot({ path: `${output}/${name}-group-plugin.png`, fullPage: true })
    await (mobile ? page.getByLabel(/^formatter · Claude Code · now on$/) : choice).selectOption(
      'inherit',
    )
    assert.deepEqual(await page.evaluate(() => window.saved.plugins), [])

    // MCP OAuth: turn on, connect, paste the callback from another device, then disconnect.
    await page.evaluate(() => window.show('oauth'))
    if (mobile) await page.getByLabel('Sign in with OAuth').selectOption('true')
    else await page.getByLabel('Sign in with OAuth').check()
    await page.getByText('Not signed in on', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByLabel('Browser address after sign-in').waitFor()
    await page
      .getByLabel('Browser address after sign-in')
      .fill('http://127.0.0.1:43123/callback?code=c&state=wrong')
    await page.getByRole('button', { name: 'Finish sign-in' }).click()
    await page.getByText('This address belongs to a different sign-in', { exact: false }).waitFor()
    await page
      .getByLabel('Browser address after sign-in')
      .fill('http://127.0.0.1:43123/callback?code=c&state=s')
    await page.getByRole('button', { name: 'Finish sign-in' }).click()
    await page.getByText('Signed in.', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Reconnect' }).waitFor()
    if (output) await page.screenshot({ path: `${output}/${name}-mcp-oauth.png`, fullPage: true })
    await page.getByRole('button', { name: 'Disconnect' }).click()
    await page.getByText('Signed out. The provider revoked the token.').waitFor()
    await page.getByRole('button', { name: 'Connect', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => JSON.stringify(window.server.oauth)), '{}')

    assert.deepEqual(errors, [])
    await page.close()
    console.log(`${name}: agent plugins, group activation and MCP OAuth views passed`)
  }
} finally {
  await browser.close()
}
