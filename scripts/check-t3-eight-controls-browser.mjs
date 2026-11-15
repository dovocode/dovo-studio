import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium, bundleBrowser } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const native = `import {useEffect} from 'react';const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s??{};
export const View=({children,style,accessibilityLabel})=><div aria-label={accessibilityLabel} style={flat(style)}>{children}</div>;
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={flat(style)}>{children}</span>;
export const ScrollView=({children})=><div>{children}</div>;
export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;
export const Alert={alert:(title,text,buttons)=>{window.confirmation={title,text,buttons};}};
export const AccessibilityInfo={announceForAccessibility:text=>window.speech.push(text),announceForAccessibilityWithOptions:text=>window.speech.push(text)};
export const AppState={currentState:'active'};export const Platform={OS:'ios'};`
const result = await bundleBrowser(
  {
    stdin: {
      loader: 'tsx',
      resolveDir: root,
      contents: `
import {useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {ProjectFolderDrop} from './packages/extension-scm/src/connections/project-folder-drop';
import {DatabaseSpace as DesktopSpace} from './packages/extension-runtime/src/database-space';
import {DatabaseSpace as MobileSpace} from './apps/mobile/src/runtime/connection/database-space';
import {SecretReferenceCheck as DesktopSecret} from './packages/studio-ui/src/secret-reference-check';
import {SecretReferenceCheck as MobileSecret} from './apps/mobile/src/agents/secret-reference-check';
import {NativeGoal as DesktopGoal} from './packages/extension-tasks/src/chat/composer/native-goal';
import {NativeGoal as MobileGoal} from './apps/mobile/src/tasks/composer/native-goal';
import {MathBlock} from './apps/mobile/src/ui/content/math-block';
import {useTurnAnnouncements} from './packages/studio-core/src/use-turn-announcements';
window.requests=[];window.pending=[];window.speech=[];window.mode='folder';window.mobile=false;window.scope='thread-one';window.announcements='messages';window.active=true;
window.space={persistent:true,fileBytes:100000,walBytes:1000,logicalBytes:100000,reclaimableBytes:40000,freeBytes:100000000};
window.request=(path,input)=>{window.requests.push({path,input});if(path.endsWith('secrets/check'))return new Promise((resolve,reject)=>window.pending.push({resolve,reject}));if(path.endsWith('storage/recover'))return Promise.resolve({after:{...window.space,reclaimableBytes:0},backup:{path:'/tmp/verified-backup.sqlite'}});if(path.endsWith('storage'))return Promise.resolve(window.space);return Promise.resolve({ok:true});};
const profile={id:'local',connection:{address:'http://local',token:'paired'}};
window.store={activeRuntimeId:'remote',localRuntimeId:'local',connection:profile.connection,connected:true,snapshot:{secretReferenceCheckSupported:true},runtimes:[{profile,connected:true}],request:window.request,call:window.request,readRuntime:async(profile,path,input,schema,method)=>{window.requests.push({runtime:profile.id,path,input,method});if(window.holdFolder)await new Promise(resolve=>window.releaseFolder=resolve);return {id:input.path}},refreshRuntime:async()=>{},switchRuntime:async(id)=>{window.store.activeRuntimeId=id;window.render()},};
window.reference={provider:'environment',reference:'APP_TOKEN'};
window.task={id:'task',sessionId:'session',status:'review',messages:[],turns:[],nativeGoal:{sessionId:'session',objective:'Finish the task',status:'paused',rounds:2,reason:'Waiting'}};
window.dovoTerminalFilePath=file=>'/tmp/'+file.name;
function Announcer(){useTurnAnnouncements({scope:window.scope,task:window.task,steps:[],mode:window.announcements,active:window.active,announce:text=>window.speech.push(text)});useEffect(()=>{window.announcerReady=true},[]);return null}
function App(){const[tick,setTick]=useState(0);window.render=()=>setTick(t=>t+1);const Secret=window.mobile?MobileSecret:DesktopSecret,Goal=window.mobile?MobileGoal:DesktopGoal,Space=window.mobile?MobileSpace:DesktopSpace;return window.mode==='folder'?<ProjectFolderDrop onAdded={id=>window.opened=id}><div data-drop>Projects</div></ProjectFolderDrop>:window.mode==='secret'?<Secret reference={window.reference}/>:window.mode==='space'?<Space/>:window.mode==='goal'?<Goal task={window.task}/>:window.mode==='math'?<MathBlock content={window.math||'x^2 + y^2 = z^2'}/>:<Announcer/>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    alias: {
      '@dovo/protocol': root + 'packages/protocol/src/index.ts',
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    nodePaths: [root + 'apps/mobile/node_modules', root + 'packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {useSecretReferenceCheck} from '${root}packages/studio-core/src/use-secret-reference-check';export const useWorkspace=()=>window.store;`,
    },
    {
      path: '@dovo/studio-core/interface-language',
      contents: `export const useInterfaceText=()=>text=>text;`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `export const Button=({children,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{children}</button>;`,
    },
    {
      path: './components/ui/button',
      importer: root + 'packages/studio-ui/src/secret-reference-check',
      contents: `export const Button=({children,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{children}</button>;`,
    },
    { path: 'react-native', contents: native },
    {
      path: '../../runtime/connection/provider',
      importer: root + 'apps/mobile/src/tasks/composer',
      contents: `export const useRuntime=()=>window.store;`,
    },
    {
      path: '../runtime/connection/provider',
      importer: root + 'apps/mobile/src/agents',
      contents: `export const useRuntime=()=>window.store;`,
    },
    {
      path: './provider',
      importer: root + 'apps/mobile/src/runtime/connection/database-space',
      contents: `export const useRuntime=()=>window.store;`,
    },
    ...['../../ui/content/text', '../../ui/theme', '../../ui/controls/action'].map((path) => ({
      path,
      importer: root + 'apps/mobile/src',
      contents: `export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;export const useTheme=()=>({styles:{muted:{},error:{},title:{}},colors:{text:'#eee',border:'#444'}});export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    })),
    ...['../ui/content/text', '../ui/controls/action'].map((path) => ({
      path,
      importer: root + 'apps/mobile/src/agents',
      contents: `export const Text=({children})=><span>{children}</span>;export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    })),
    { path: 'expo-crypto', contents: `export const randomUUID=()=>crypto.randomUUID();` },
    {
      path: './text',
      importer: root + 'apps/mobile/src/ui/content/math-block',
      contents: `export const Text=({children})=><span>{children}</span>;`,
    },
    {
      path: '../theme',
      importer: root + 'apps/mobile/src/ui/content/math-block',
      contents: `export const useTheme=()=>({styles:{muted:{}},colors:{text:'#eee'}});`,
    },
    {
      path: './code-block',
      importer: root + 'apps/mobile/src/ui/content/math-block',
      contents: `export const CodeBlock=({content})=><pre>{content}</pre>;`,
    },
    {
      path: 'react-native-enriched-markdown',
      contents: `export const EnrichedMarkdownText=({markdown,onLatexError,allowFontScaling,md4cFlags})=><div data-math data-scaling={allowFontScaling} data-latex={md4cFlags.latexMath}>{markdown}<button onClick={onLatexError}>Fail math</button></div>;`,
    },
  ],
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://127.0.0.1:8789/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://127.0.0.1:8789/')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const mode = async (mode, mobile = false) => {
    await page.evaluate(
      ({ mode, mobile }) => {
        window.mode = mode
        window.mobile = mobile
        window.render()
      },
      { mode, mobile },
    )
  }
  const drop = async (names) =>
    page.locator('[data-drop]').evaluate((node, names) => {
      const items = names.map((name) => ({
        webkitGetAsEntry: () => ({ isDirectory: !name.endsWith('.txt') }),
        getAsFile: () => new File([''], name),
      }))
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], items } })
      node.dispatchEvent(event)
    }, names)
  await drop(['First', 'Second', 'file.txt'])
  await page.getByText('Project folders added on this computer.').waitFor()
  assert.deepEqual(
    await page.evaluate(() =>
      window.requests.map(({ runtime, input, method }) => ({ runtime, input, method })),
    ),
    [
      {
        runtime: 'local',
        input: { source: 'local', name: 'First', path: '/tmp/First' },
        method: 'POST',
      },
      {
        runtime: 'local',
        input: { source: 'local', name: 'Second', path: '/tmp/Second' },
        method: 'POST',
      },
    ],
  )
  assert.equal(await page.evaluate(() => window.opened), '/tmp/Second')
  await page.evaluate(() => {
    window.holdFolder = true
    window.opened = undefined
  })
  await drop(['Delayed'])
  await page.evaluate(() => {
    window.store.activeRuntimeId = 'another'
    window.render()
    window.releaseFolder()
  })
  await page.getByText('Project folders added on this computer.').waitFor()
  assert.equal(await page.evaluate(() => window.opened), undefined)
  for (const mobile of [false, true]) {
    await mode('secret', mobile)
    await page.getByRole('button', { name: 'Check reference', exact: true }).click()
    await page.evaluate((mobile) => {
      window.reference = { provider: 'environment', reference: 'CHANGED_' + mobile }
      window.render()
      window.pending.shift().resolve({ ok: true })
    }, mobile)
    await page.waitForTimeout(30)
    assert.equal(await page.getByText('Secret reference resolved', { exact: true }).count(), 0)
    // An A -> B -> A edit must invalidate A's original in-flight result too.
    await page.getByRole('button', { name: 'Check reference', exact: true }).click()
    const reference = await page.evaluate(() => window.reference)
    await page.evaluate(() => {
      window.reference = { provider: 'environment', reference: 'TEMPORARY' }
      window.render()
    })
    await page.waitForTimeout(30)
    await page.evaluate((reference) => {
      window.reference = reference
      window.render()
    }, reference)
    await page.waitForTimeout(30)
    await page.evaluate(() => window.pending.shift().resolve({ ok: true }))
    await page.waitForTimeout(30)
    assert.equal(await page.getByText('Secret reference resolved', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Check reference', exact: true }).click()
    await page.evaluate(() => window.pending.shift().resolve({ ok: true }))
    await page.getByText('Secret reference resolved', { exact: true }).waitFor()
    await page.evaluate((mobile) => {
      window.store.connection = { address: 'http://other-' + mobile, token: 'other' }
      window.render()
    }, mobile)
    await page.waitForTimeout(30)
    assert.equal(await page.getByText('Secret reference resolved', { exact: true }).count(), 0)
    await mode('goal', mobile)
    await page.getByRole('button', { name: 'Resume goal' }).click()
    assert.equal(await page.evaluate(() => window.requests.at(-1).input.text), '/goal resume')
    await page.evaluate(() => {
      window.task = { ...window.task, status: 'running' }
      window.render()
    })
    await page.getByText('Stop the turn to pause this goal.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Clear goal' }).count(), 0)
    await page.evaluate(() => {
      window.task = { ...window.task, status: 'review', sessionId: 'new-session' }
      window.render()
    })
    await page.waitForTimeout(30)
    assert.equal(await page.getByText('Finish the task', { exact: true }).count(), 0)
    await page.evaluate(() => {
      window.task.sessionId = 'session'
    })
    await mode('space', mobile)
    await page.getByRole('button', { name: 'Recover database space', exact: true }).click()
    assert.equal(
      await page.evaluate(() => window.requests.filter((r) => r.path.endsWith('/recover')).length),
      mobile ? 1 : 0,
    )
    if (mobile) await page.evaluate(() => window.confirmation.buttons[1].onPress())
    else await page.getByRole('button', { name: 'Create backup and recover' }).click()
    await page.getByText(/Space recovery finished/).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Recover database space', exact: true }).isDisabled(),
      true,
    )
  }
  await mode('math', true)
  assert.equal(await page.locator('[data-math]').getAttribute('data-scaling'), 'true')
  assert.equal(await page.locator('[data-math]').getAttribute('data-latex'), 'true')
  await page.getByRole('button', { name: 'Show equation source' }).click()
  await page.locator('pre').filter({ hasText: 'x^2' }).waitFor()
  await page.getByRole('button', { name: 'Show equation', exact: true }).click()
  await page.getByRole('button', { name: 'Fail math' }).click()
  await page.locator('pre').waitFor()
  await page.getByRole('button', { name: 'Show equation', exact: true }).click()
  await page.locator('[data-math]').waitFor()
  await page.clock.install()
  await mode('announcements')
  await page.waitForFunction(() => window.announcerReady)
  await page.evaluate(() => {
    window.task = {
      ...window.task,
      status: 'running',
      messages: [
        { id: 'new', role: 'assistant', text: 'First. Second.', turnId: 'turn', textBreaks: [] },
      ],
      turns: [
        { id: 'turn', assistantId: 'new', startedAt: new Date().toISOString(), status: 'running' },
      ],
    }
    window.render()
  })
  await page.waitForFunction(() => window.speech.length === 1)
  assert.deepEqual(await page.evaluate(() => window.speech), ['Agent is working.'])
  await page.evaluate(() => {
    window.task = { ...window.task, messages: [{ ...window.task.messages[0], textBreaks: [6] }] }
    window.render()
  })
  await page.clock.fastForward(2100)
  await page.waitForFunction(() => window.speech.length === 2)
  assert.equal(await page.evaluate(() => window.speech.at(-1)), 'First.')
  await page.evaluate(() => {
    window.task = {
      ...window.task,
      messages: [{ ...window.task.messages[0], textBreaks: [6, 14] }],
    }
    window.render()
  })
  await page.waitForTimeout(20)
  await page.evaluate(() => {
    window.scope = 'different-thread'
    window.render()
  })
  await page.clock.fastForward(5000)
  assert.deepEqual(await page.evaluate(() => window.speech), ['Agent is working.', 'First.'])
  await page.evaluate(() => {
    window.announcements = 'off'
    window.render()
  })
  await page.waitForTimeout(20)
  await page.evaluate(() => {
    window.task = { ...window.task, status: 'failed' }
    window.render()
  })
  await page.clock.fastForward(5000)
  assert.equal(await page.evaluate(() => window.speech.length), 2)
  assert.deepEqual(errors, [])
  console.log(
    'Folder ownership, stale replies, desktop/mobile vault checks, goals, storage review and mobile math controls pass.',
  )
} finally {
  await browser.close()
}
