import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const native = `${root}apps/mobile/src/`
const webRequire = createRequire(new URL('../packages/studio-ui/package.json', import.meta.url))
const built = await bundleBrowser(
  {
    alias: {
      react: dirname(webRequire.resolve('react/package.json')),
      'react-dom': dirname(webRequire.resolve('react-dom/package.json')),
      '@dovo/client-runtime': `${root}packages/client-runtime/src/index.ts`,
      '@dovo/protocol': `${root}packages/protocol/src/index.ts`,
    },
    stdin: {
      resolveDir: `${root}packages/studio-ui`,
      loader: 'tsx',
      contents: `
      import {useState} from 'react';import {createRoot} from 'react-dom/client';import {Effect} from 'effect';
      import {TaskApprovals} from '../../apps/mobile/src/tasks/detail/approvals';
      import {ProjectApprovalRules} from '../../apps/mobile/src/tasks/detail/project-approval-rules';
      import {RuntimePreferences} from '../../apps/mobile/src/runtime/connection/runtime-preferences';
      import {RunningTaskPreferences} from '../extension-runtime/src/runtime-preferences';
      import {decode,runtimePreferencesSchema} from '@dovo/protocol';
      import {RunControls} from '../extension-tasks/src/chat/actions/run-controls';
      import {TaskProjectActions} from '../extension-tasks/src/detail/task-project-actions';
      const task={id:'task',repositoryId:'repo',title:'Task',status:'running',messages:[],files:[],draft:'',example:false};
      const initial={id:'approval',taskId:'task',title:'WebSearch',detail:'Search for documentation',rememberRule:'web'};
      window.writes=[];window.ruleCloses=0;
      window.computerPreferences=decode(runtimePreferencesSchema,{});
      function App(){
        const [mode,setMode]=useState('projects'),[globalWeb,setGlobalWeb]=useState(false),[supported,setSupported]=useState(true);window.webRulesSupported=setSupported;
        window.showSystem=setMode;
        const [approval,setApproval]=useState(initial),[online,setOnline]=useState(true),[project,setProject]=useState({id:'repo',name:'Project',approvedWebRequests:true});
        window.approval=value=>setApproval({...initial,...value});window.online=setOnline;
        const snapshot={allowWebRequests:supported?globalWeb:undefined,workspace:{repositories:[project],tasks:[task],agents:[]},approvals:[approval],runs:[]};
        const request=async(path,input,schema,method)=>{
          if(path==='/api/runtime/preferences/read')return window.computerPreferences;
          if(path==='/api/memory/projects/read')return {projects:[]};
          window.writes.push({path,input,method});
          if(path==='/api/runtime/preferences/save'){window.computerPreferences=decode(runtimePreferencesSchema,{...window.computerPreferences,...input});setGlobalWeb(window.computerPreferences.allowWebRequests);return window.computerPreferences};
          if(path==='/api/workspace')setProject(current=>({...current,approvedWebRequests:input.changes.approvedWebRequests.after}));return {ok:true,revision:2}
        };
        const requestEffect=(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error});
        window.native={overviews:[],connected:online,snapshot,profile:{name:'Computer',connection:{address:'http://computer',token:'test-token'}},readEffect:requestEffect,callEffect:requestEffect};
        window.store={connected:online,snapshot,workspace:snapshot.workspace,runtimes:[],request,requestEffect,setWorkspace:update=>setProject(update(snapshot.workspace).repositories[0])};
        window.project=project;
        if(mode==='mobile-system')return <RuntimePreferences/>;
        if(mode==='desktop-system')return <RunningTaskPreferences/>;
        return <><section id="mobile"><TaskApprovals taskId="task"/><ProjectApprovalRules repositoryId="repo" onClose={()=>window.ruleCloses++}/></section><section id="desktop"><RunControls task={task}/><TaskProjectActions task={task} onTerminal={()=>{}}/></section></>;
      }
      createRoot(document.getElementById('app')).render(<App/>);
    `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  [
    {
      path: 'expo-router',
      contents: 'export const router={push:()=>{}};',
    },
    {
      path: '../preferences/settings-target',
      importer: `${native}runtime/connection/`,
      contents: 'export const useSettingsDraft=()=>{};',
    },
    {
      path: 'react-native',
      contents: `
      const css=style=>Object.assign({},...(Array.isArray(style)?style:[style]).flat().filter(Boolean));
      export const View=({children,style})=><div style={{display:'flex',flexDirection:'column',minWidth:0,flexShrink:0,...css(style)}}>{children}</div>;
      export const ScrollView=({children,style,contentContainerStyle})=><div style={{...css(style),overflowY:'auto'}}><div style={css(contentContainerStyle)}>{children}</div></div>;
      export const Pressable=({children,onPress,accessibilityRole,accessibilityLabel,accessibilityState,style})=><button role={accessibilityRole} aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} onClick={onPress} style={css(style)}>{children}</button>;
    `,
    },
    {
      path: '../../runtime/connection/provider',
      importer: native,
      contents: 'export const useRuntime=()=>window.native;',
    },
    {
      path: '../../runtime/state/application-state',
      importer: native,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '../../ui/theme',
      importer: native,
      contents:
        'export const useTheme=()=>({styles:{card:{padding:12,border:"1px solid #444",borderRadius:12,display:"flex",flexDirection:"column",gap:8},text:{color:"#eee"},muted:{color:"#aaa"},row:{display:"flex",flexDirection:"row",gap:6,flexWrap:"wrap"}},colors:{border:"#444",background:"#181818"}});',
    },
    {
      path: '../../ui/content/text',
      importer: native,
      contents:
        'export const Text=({children,style})=>{const flat=Object.assign({},...(Array.isArray(style)?style:[style]).filter(Boolean));return <span style={{...flat,...(typeof flat.lineHeight==="number"?{lineHeight:flat.lineHeight+"px"}:{})}}>{children}</span>};',
    },
    {
      path: '../../ui/layout/sheet',
      importer: native,
      contents: 'export const Sheet=({title,children})=><div><h2>{title}</h2>{children}</div>;',
    },
    {
      path: '../../ui/controls/action',
      importer: native,
      contents:
        'export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;',
    },
    {
      path: '@dovo/studio-core/state',
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '@dovo/studio-core',
      contents:
        "export * from '@dovo/protocol';export {clientTaskScope} from '@dovo/client-runtime';export const useWorkspace=()=>window.store;export const useSettingsDraft=()=>{};",
    },
    {
      path: '@dovo/studio-ui',
      contents: `
    export {Button} from './src/components/ui/button';
    export const IconButton=({children,label,onClick})=><button aria-label={label} onClick={onClick}>{children}</button>;
    const Wrapper=({children})=><div>{children}</div>;
    export const Dialog=Wrapper,DialogContent=Wrapper,DialogTitle=Wrapper,DialogDescription=Wrapper,Input=()=>null;
    export const SettingRow=({children,description})=><div><p>{description}</p>{children}</div>;export const SettingsGroup=Wrapper,Select=Wrapper,SelectContent=Wrapper,SelectItem=Wrapper,SelectTrigger=Wrapper,SelectValue=()=>null;
    export const Toggle=({label,checked,onChange,disabled})=><button role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={()=>onChange(!checked)}>{label}</button>;
    export const DropdownMenu={Root:Wrapper,Trigger:Wrapper,Portal:Wrapper,Content:Wrapper,Separator:()=>null,Item:({children,onSelect})=><button onClick={onSelect}>{children}</button>};
  `,
    },
    {
      path: './provider',
      importer: `${native}runtime/connection/`,
      contents: 'export const useRuntime=()=>window.native;',
    },
    {
      path: '../state/application-state',
      importer: `${native}runtime/connection/`,
      contents: "export {useState as useApplicationState} from 'react';",
    },
    {
      path: '../../screens/settings-group',
      importer: `${native}runtime/connection/`,
      contents:
        'export const SettingsGroup=({children})=><div>{children}</div>;export const SettingsSwitchRow=({label,value,onValueChange,disabled})=><button role="switch" aria-label={label} aria-checked={value} disabled={disabled} onClick={()=>onValueChange(!value)}>{label}</button>;',
    },
    {
      path: '../../screens/settings-controls',
      importer: `${native}runtime/connection/`,
      contents:
        'export const SettingsChoice=()=>null,SettingsField=()=>null,SettingsAction=()=>null;',
    },
    ...[
      ['task-templates-dialog', 'TaskTemplatesDialog'],
      ['saved-prompts-dialog', 'SavedPromptsDialog'],
      ['project-instructions-dialog', 'ProjectInstructionsDialog'],
    ].map(([file, name]) => ({
      path: `../dialogs/${file}`,
      importer: `${root}packages/extension-tasks/src/detail`,
      contents: `export const ${name}=()=>null;`,
    })),
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  await page.setContent('<div id="app"></div>')
  const assetDirectory = new URL('../apps/web/dist/client/assets/', import.meta.url)
  const css = (await readdir(assetDirectory)).filter((path) => path.endsWith('.css'))
  for (const file of css)
    await page.addStyleTag({ content: await readFile(new URL(file, assetDirectory), 'utf8') })
  await page.addStyleTag({
    content: 'html{color-scheme:dark;background:var(--background);color:var(--foreground)}',
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const id of ['mobile', 'desktop']) {
    const ui = page.locator(`#${id}`)
    await ui.getByRole('button', { name: 'Always allow web in this project', exact: true }).click()
    await page.waitForFunction((count) => window.writes.length >= count, id === 'mobile' ? 1 : 4)
    assert.deepEqual(await page.evaluate(() => window.writes.at(-1).input), {
      id: 'approval',
      allow: true,
      decision: 'always',
    })
    for (const allow of [true, false]) {
      await ui.getByRole('button', { name: allow ? 'Allow once' : 'Deny', exact: true }).click()
      await page.waitForFunction(({ count }) => window.writes.length >= count, {
        count: (id === 'mobile' ? 1 : 4) + (allow ? 1 : 2),
      })
      assert.deepEqual(await page.evaluate(() => window.writes.at(-1).input), {
        id: 'approval',
        allow,
        decision: allow ? 'approve' : 'deny',
      })
    }
  }
  const writesBeforeDetails = await page.evaluate(() => window.writes.length)
  const requestDetail = {
    threadId: 'provider-thread-id',
    turnId: 'provider-turn-id',
    itemId: 'provider-item-id',
    command: 'pnpm test --filter "mobile app"',
    cwd: '/work/my project',
    reason: 'Verify the mobile changes',
    additionalPermissions: { fileSystem: { write: ['/tmp/test-output'] }, network: false },
    unfamiliar_option: { timeout: 0, mode: null },
  }
  await page.evaluate(
    (detail) => window.approval({ title: 'Run command', detail: JSON.stringify(detail) }),
    requestDetail,
  )
  if (process.env.DOVO_PERMISSION_SCREENSHOTS) {
    await page.locator('#mobile').getByText(requestDetail.command, { exact: true }).waitFor()
    for (const platform of ['desktop', 'mobile']) {
      await page.setViewportSize({ width: platform === 'desktop' ? 1080 : 390, height: 844 })
      const style = await page.addStyleTag({
        content: `#${platform === 'desktop' ? 'mobile' : 'desktop'}{display:none}#${platform}{padding:16px}`,
      })
      await page.screenshot({ path: `/tmp/dovo-permission-${platform}.png` })
      await style.evaluate((element) => element.remove())
    }
  }
  for (const id of ['mobile', 'desktop']) {
    const ui = page.locator(`#${id}`)
    for (const value of [
      'Reason',
      requestDetail.reason,
      'Command',
      requestDetail.command,
      'Working folder',
      requestDetail.cwd,
      'Additional permissions',
      'File access',
      '/tmp/test-output',
      'Unfamiliar option',
      'Not set',
    ])
      await ui.getByText(value, { exact: true }).waitFor()
    await ui.getByText('/tmp/test-output', { exact: true }).scrollIntoViewIfNeeded()
    assert.equal(
      await ui.getByRole('button', { name: 'Allow once', exact: true }).isVisible(),
      true,
    )
    assert.equal(
      await ui.getByText(/provider-thread-id/).isVisible(),
      false,
      'Provider metadata stays in the full payload',
    )
    const toggle =
      id === 'mobile'
        ? ui.getByRole('button', { name: 'Show full JSON' })
        : ui.locator('summary').filter({ hasText: 'Full JSON' })
    await toggle.click()
    const raw = ui.getByText(/"threadId": "provider-thread-id"/)
    await raw.waitFor()
    assert.deepEqual(JSON.parse(await raw.textContent()), requestDetail)
    await (id === 'mobile' ? ui.getByRole('button', { name: 'Hide full JSON' }) : toggle).click()
    assert.equal(await raw.isVisible(), false)
  }
  for (const detail of [
    'https://example.com/docs\nhttps://example.com/api',
    '{"command":',
    '<script>window.permissionInjected=true</script>',
  ]) {
    await page.evaluate((detail) => window.approval({ detail }), detail)
    for (const id of ['mobile', 'desktop'])
      await page.locator(`#${id}`).getByText(detail, { exact: true }).waitFor()
  }
  assert.equal(await page.evaluate(() => window.permissionInjected), undefined)
  assert.equal(
    await page.evaluate(() => window.writes.length),
    writesBeforeDetails,
    'Inspecting details never approves a request',
  )
  await page.evaluate(() => window.approval({}))
  await page.evaluate(() => window.online(false))
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')]
      .filter((button) => button.textContent === 'Always allow web in this project')
      .every((button) => button.disabled),
  )
  for (const id of ['mobile', 'desktop'])
    assert.equal(
      await page
        .locator(`#${id}`)
        .getByRole('button', { name: 'Always allow web in this project', exact: true })
        .isDisabled(),
      true,
    )
  await page.evaluate(() => {
    window.online(true)
    window.approval({ title: 'Apply file changes', rememberRule: null })
  })
  await page.locator('#mobile').getByText('Apply file changes', { exact: true }).waitFor()
  assert.equal(
    await page
      .locator('#mobile')
      .getByRole('button', { name: /Always allow.*in this project/ })
      .count(),
    0,
  )
  assert.equal(
    await page
      .locator('#desktop')
      .getByRole('button', { name: 'Always allow in this project', exact: true })
      .count(),
    0,
  )
  // Older runtimes still expose their existing command-only remembering behavior.
  await page.evaluate(() => window.approval({ title: 'Run command', rememberRule: undefined }))
  await page
    .locator('#mobile')
    .getByRole('button', { name: 'Always allow in this project', exact: true })
    .waitFor()
  await page
    .locator('#mobile')
    .getByRole('button', { name: 'Ask before web requests', exact: true })
    .click()
  await page.waitForFunction(
    () => window.ruleCloses === 1 && window.project.approvedWebRequests === false,
  )
  assert.deepEqual(await page.evaluate(() => window.writes.at(-1)), {
    path: '/api/workspace',
    method: 'PATCH',
    input: {
      collection: 'repositories',
      id: 'repo',
      changes: { approvedWebRequests: { before: true, after: false } },
    },
  })
  await page.locator('#desktop').getByRole('button', { name: 'Manage approval rules…' }).click()
  await page
    .locator('#desktop')
    .getByRole('button', { name: 'Always allow web requests', exact: true })
    .click()
  await page.waitForFunction(() => window.project.approvedWebRequests === true)
  await page
    .locator('#desktop')
    .getByRole('button', { name: 'Ask before web requests', exact: true })
    .click()
  await page.waitForFunction(() => window.project.approvedWebRequests === false)
  for (const mode of ['mobile-system', 'desktop-system']) {
    await page.evaluate((mode) => window.showSystem(mode), mode)
    const flag = page.getByRole('switch', {
      name: 'Always allow web requests on this computer',
      exact: true,
    })
    await flag.waitFor()
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[role="switch"][aria-label="Always allow web requests on this computer"]',
        ).disabled,
    )
    assert.equal(await flag.isChecked(), false)
    await flag.click()
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Always allow web requests on this computer"]')
          .getAttribute('aria-checked') === 'true',
    )
    assert.deepEqual(await page.evaluate(() => window.writes.at(-1).input), {
      allowWebRequests: true,
    })
    await page.evaluate(() => window.showSystem('projects'))
    await page
      .locator('#mobile')
      .getByText(/always allowed on this computer/)
      .waitFor()
    assert.equal(
      await page
        .locator('#mobile')
        .getByRole('button', { name: 'Always allow web requests', exact: true })
        .isDisabled(),
      true,
    )
    await page.locator('#desktop').getByRole('button', { name: 'Manage approval rules…' }).click()
    assert.equal(
      await page
        .locator('#desktop')
        .getByRole('button', { name: 'Always allow web requests', exact: true })
        .isDisabled(),
      true,
    )
    await page.evaluate((mode) => window.showSystem(mode), mode)
    await flag.waitFor()
    await page.waitForFunction(
      () =>
        !document.querySelector(
          '[role="switch"][aria-label="Always allow web requests on this computer"]',
        ).disabled,
    )
    assert.equal(await flag.isChecked(), true)
    await flag.click()
    await page.waitForFunction(() => window.computerPreferences.allowWebRequests === false)
  }
  await page.evaluate(() => {
    window.webRulesSupported(false)
    window.showSystem('projects')
  })
  await page
    .locator('#mobile')
    .getByText(/Update Dovo on this computer/)
    .waitFor()
  assert.equal(
    await page
      .locator('#mobile')
      .getByRole('button', { name: 'Always allow web requests', exact: true })
      .isDisabled(),
    true,
  )
  await page.locator('#desktop').getByRole('button', { name: 'Manage approval rules…' }).click()
  assert.equal(
    await page
      .locator('#desktop')
      .getByRole('button', { name: 'Always allow web requests', exact: true })
      .isDisabled(),
    true,
  )
  for (const mode of ['mobile-system', 'desktop-system']) {
    await page.evaluate((mode) => window.showSystem(mode), mode)
    await page
      .getByRole('switch', { name: 'Always allow web requests on this computer', exact: true })
      .waitFor()
    await page.getByText(/Update Dovo on this computer/).waitFor()
    assert.equal(
      await page
        .getByRole('switch', { name: 'Always allow web requests on this computer', exact: true })
        .isDisabled(),
      true,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Supervised web approvals: mobile and desktop remembering, once, deny, offline, compatibility, and revocation passed.',
  )
} finally {
  await browser.close()
}
