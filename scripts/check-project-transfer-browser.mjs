import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const native = `
const flat=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));
export const View=({children,style,accessibilityRole,accessibilityLabel})=><div role={accessibilityRole} aria-label={accessibilityLabel} style={{display:'flex',flexDirection:'column',...flat(style)}}>{children}</div>;
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole} style={flat(style)}>{children}</span>;
export const SettingsAction=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const SettingsChoice=({label,value,items,onChange,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;
export const SettingsField=({label,value,onChangeText,editable})=><input aria-label={label} value={value} disabled={editable===false} onChange={event=>onChangeText(event.target.value)}/>;
export const Switch=({accessibilityLabel,value,onValueChange,disabled})=><input type="checkbox" aria-label={accessibilityLabel} checked={value} disabled={disabled} onChange={event=>onValueChange(event.target.checked)}/>;
export const useTheme=()=>({colors:{text:'#eee',muted:'#aaa',error:'#ff6969',border:'#444',action:'#6699ff'},styles:{text:{color:'#eee'},muted:{color:'#aaa'}}});
`
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const path = mobile
      ? 'apps/mobile/src/scm/connections/project-transfer'
      : 'packages/extension-scm/src/connections/project-transfer'
    const importer = root + path
    const stubs = mobile
      ? [
          {
            path: '../../shell/navigation',
            importer,
            contents: `export const useNavigation=()=>({navigate:(...args)=>window.opened=args});`,
          },
          { path: 'react-native', contents: native },
          {
            path: '../../ui/layout/sheet',
            importer,
            contents:
              'export const Sheet=({title,children,onClose})=><div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close copy</button></div>',
          },
          ...[
            '../../ui/content/text',
            '../../screens/settings-controls',
            '../../ui/controls/switch',
            '../../ui/theme',
          ].map((path) => ({ path, importer, contents: native })),
          {
            path: '../../runtime/connection/provider',
            importer,
            contents: 'export const useRuntime=()=>window.store;',
          },
          {
            path: 'expo-crypto',
            contents: "export {randomUUID} from './packages/protocol/src/index';",
          },
        ]
      : [
          {
            path: '@dovo/studio-core',
            contents: `export const useWorkspace=()=>window.store;export const useStudioHost=()=>({navigate:target=>window.opened=target});`,
          },
          {
            path: '@dovo/studio-ui',
            contents: `export {Button} from './packages/studio-ui/src/components/ui/button';export {Input} from './packages/studio-ui/src/components/ui/input';export {FormField} from './packages/studio-ui/src/components/form-field';export * from './packages/studio-ui/src/components/ui/dialog';`,
          },
        ]
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ProjectTransferSettings,ProjectTransferDialog} from './${path}';
const profile={id:'destination',name:'Desktop',connection:{address:'http://desktop:5235',runtimeId:'machine-b',token:'paired-device-token-with-32-characters'}};
const repo={id:'project',name:'My project',path:'/project',branch:'main'};
window.calls=[];window.refreshes=0;let current=null;
function App(){const [source,setSource]=useState(null);window.setSource=setSource;const [preview,setPreview]=useState(false);window.previewTransfer=()=>{setSource(null);setJob(null);setPreview(true)};const [job,setJob]=useState(null),[connected,setConnected]=useState(true),[supported,setSupported]=useState(true);window.setSupported=setSupported;window.setConnected=setConnected;
window.setJob=changes=>setJob(old=>{current={...old,...changes,updatedAt:(old?.updatedAt??0)+100};return current});
const request=async(path,input)=>{window.calls.push({path,input});
if(path==='/api/scm/worktrees/read')return {root:'/worktrees',worktrees:window.missingWorktree?[]:[{path:'/worktrees/feature',repositoryId:'project',branch:'feature',taskId:'owner',threadIds:['owner','reused'],prunable:false}]};
if(path.endsWith('/choices'))return {worktrees:[{path:'/worktrees/feature',branch:'feature',dirty:true}]};
if(path.endsWith('/plan')){if(window.planError)throw new Error('Update the destination computer to copy linked worktrees');return {repositories:window.noDestinationProject?[]:[{id:'destination-project',name:'Existing project',path:'/projects/main'}],worktreesRoot:'/custom/worktrees'};}
if(path.endsWith('/targets'))return [{id:'machine-b',name:'Desktop',directSupported:!window.internetOnly}];
if(path.endsWith('/inspect')){if(window.failInspect)throw new Error('Inspection failed');return {files:3,bytes:1500,skippedLinks:1,ignoredFilesTruncated:window.truncated,ignoredFiles:[{path:'.env.local',bytes:12},{path:'private.key',bytes:7}]};}
if(path.endsWith('/start')){if(window.fail)throw new Error('Destination is offline');current={...input,targetName:'Desktop',state:'copying',transport:input.ssh?'ssh':'p2p',bytes:100,totalBytes:1000,updatedAt:Date.now()};setJob(current);return current}
if(path.endsWith('/retry')){window.setJob({state:'preparing',error:undefined});return {...current,state:'preparing'}}
if(path.endsWith('/cancel')){window.setJob({state:'cancelled'});return {ok:true}}
return {ok:true};};
window.store={connected,request,read:request,call:request,snapshot:{runtimeId:'machine-a',projectTransfersSupported:supported,projectWorktreeTransfersSupported:supported,projectTransfers:job?[job]:[]},runtimeRegistry:{profiles:[profile]},profiles:[profile],runtimes:[{profile,connected:true,snapshot:{runtimeId:'machine-b',sshAddress:window.savedSsh??''}}],overviews:[{profile,connected:true,snapshot:{runtimeId:'machine-b'}}],switchRuntime:async id=>{window.switched=id},refreshRuntime:async()=>{window.refreshes++}};
return source||preview ? <ProjectTransferDialog key={source?.id??'preview'} repository={repo} sourceTask={source??undefined} onClose={()=>{setSource(null);setPreview(false)}}/> : <ProjectTransferSettings repository={repo}/>;}
createRoot(document.getElementById('app')).render(<App/>);`,
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        alias: {
          react: root + 'packages/studio-ui/node_modules/react',
          'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
        },
      },
      stubs,
    )
    const page = await browser.newPage({
      viewport: { width: mobile ? 390 : 700, height: 850 },
      reducedMotion: 'reduce',
    })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<body style="background:#202020;color:#eee"><div id="app"></div></body>')
    if (!mobile) {
      await page.evaluate(() => document.documentElement.classList.add('dark'))
      for (const file of readdirSync(root + 'apps/desktop/dist/assets').filter((file) =>
        file.endsWith('.css'),
      ))
        await page.addStyleTag({
          content: readFileSync(root + 'apps/desktop/dist/assets/' + file, 'utf8'),
        })
    }
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.evaluate(() => {
      window.failInspect = true
    })
    await page
      .getByRole('button', {
        name: mobile ? 'Add to another computer' : 'Configure project copy',
        exact: true,
      })
      .click()
    const copy = page.getByRole('button', { name: 'Copy project', exact: true })
    await page.getByRole('alert').filter({ hasText: 'Inspection failed' }).waitFor()
    // A file-inspection error must not hide otherwise valid destination computers.
    assert.equal(await page.getByLabel('Destination computer').inputValue(), 'machine-b')
    assert.equal(await copy.isDisabled(), true)
    await page.evaluate(() => {
      window.failInspect = false
      window.truncated = true
    })
    await page
      .getByRole('button', { name: mobile ? 'Refresh copy options' : 'Refresh', exact: true })
      .click()
    await page.getByText(/Only the first 10,000 ignored or private files are listed/).waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Copy project' && !button.disabled,
      ),
    )
    assert.equal(await page.getByLabel('Destination computer').inputValue(), 'machine-b')
    assert.equal(await page.getByLabel('Project copy connection').inputValue(), 'p2p')
    await page.evaluate(() => {
      window.internetOnly = true
    })
    await page
      .getByRole('button', { name: mobile ? 'Refresh copy options' : 'Refresh', exact: true })
      .click()
    await page
      .getByText('This destination requires an SSH tunnel or a LAN/VPN pairing for project copies.')
      .waitFor()
    assert.equal(await copy.isDisabled(), true)
    await page.getByLabel('Project copy connection').selectOption('ssh')
    assert.equal(await copy.isDisabled(), false)
    await page.evaluate(() => {
      window.internetOnly = false
    })
    await page
      .getByRole('button', { name: mobile ? 'Refresh copy options' : 'Refresh', exact: true })
      .click()
    await page.getByLabel('Project copy connection').selectOption('p2p')
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Copy project' && !button.disabled,
      ),
    )
    if (mobile)
      await page.getByRole('button', { name: 'Ignored or private files (0 selected)' }).click()
    else await page.locator('summary').click()
    const config = mobile
      ? page.getByRole('checkbox', { name: 'Include .env.local', exact: true })
      : page.locator('label').filter({ hasText: '.env.local' }).getByRole('checkbox')
    await config.check()
    await copy.click()
    await page.getByText('Copying to Desktop · 10%', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Destination computer').isDisabled(), true)
    const first = await page.evaluate(
      () => window.calls.find((call) => call.path.endsWith('/start')).input,
    )
    assert.deepEqual(first.ignoredFiles, ['.env.local'])
    assert.equal(first.ssh, undefined)
    await page.getByRole('button', { name: 'Cancel copy', exact: true }).click()
    await page.getByText('Copy cancelled', { exact: true }).waitFor()
    await page.getByLabel('Project copy connection').selectOption('ssh')
    await copy.click()
    await page.getByRole('alert').waitFor()
    assert.equal(
      await page.evaluate(() => window.calls.filter((call) => call.path.endsWith('/start')).length),
      1,
    )
    await page.getByRole('textbox', { name: 'SSH user', exact: true }).fill('dominic')
    await page.getByRole('textbox', { name: 'SSH host', exact: true }).fill('buildbox.local')
    await copy.click()
    await page.getByText('Copying to Desktop · 10%', { exact: true }).waitFor()
    const second = await page.evaluate(
      () => window.calls.filter((call) => call.path.endsWith('/start')).at(-1).input,
    )
    assert.deepEqual(second.ssh, {
      sshHost: 'buildbox.local',
      sshUser: 'dominic',
      sshPort: 22,
      runtimePort: 5235,
      identityFile: undefined,
    })
    await page.evaluate(() => window.setJob({ state: 'failed', error: 'Connection interrupted' }))
    await page.getByText('Connection interrupted', { exact: true }).waitFor()
    // Retry uses the server's saved request, even after form edits.
    await page.getByRole('textbox', { name: 'SSH user', exact: true }).fill('changed')
    await page.getByRole('button', { name: 'Retry copy', exact: true }).click()
    await page.waitForFunction(() => window.calls.some((call) => call.path.endsWith('/retry')))
    assert.deepEqual(
      await page.evaluate(() => window.calls.find((call) => call.path.endsWith('/retry')).input),
      { id: second.id },
    )
    await page.evaluate(() =>
      window.setJob({
        state: 'completed',
        path: '/home/dominic/.dovo/projects/copied',
        targetRepositoryId: 'copied',
      }),
    )
    await page.getByText('Added to Desktop', { exact: true }).waitFor()
    await page.waitForFunction(() => window.refreshes === 1)
    await page.evaluate(() => window.setConnected(false))
    assert.equal(await copy.isDisabled(), true)
    await page.evaluate(() => window.setSupported(false))
    await page
      .getByText('Update this computer to copy projects to another computer.', { exact: true })
      .waitFor()
    assert.deepEqual(errors, [])
    await page.evaluate(() => {
      window.setSupported(true)
      window.setJob({ state: 'cancelled' })
      window.setConnected(true)
    })
    await page.getByLabel('Project copy connection').selectOption('p2p')
    await page.getByLabel('Source checkout').selectOption('/worktrees/feature')
    await page.getByLabel('Destination project', { exact: true }).waitFor()
    assert.equal(
      await page.getByLabel('Destination project', { exact: true }).inputValue(),
      'destination-project',
    )
    await page.getByText(/Copied worktree directory: \/custom\/worktrees/).waitFor()
    // A missing main project requires a destination parent, before any files are sent.
    await page.evaluate(() => {
      window.noDestinationProject = true
    })
    await page
      .getByRole('button', { name: mobile ? 'Refresh copy options' : 'Refresh', exact: true })
      .click()
    const projectParent = page.getByRole('textbox', {
      name: 'Project parent folder on destination',
      exact: true,
    })
    await projectParent.waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Copy worktree', exact: true }).isDisabled(),
      true,
    )
    await projectParent.fill('/projects')
    const thread = page.getByRole('checkbox', {
      name: 'Create a thread on destination',
      exact: true,
    })
    await thread.check()
    await page
      .getByRole('textbox', { name: 'First message (optional)', exact: true })
      .fill('Continue reviewing these changes')
    await page.getByRole('button', { name: 'Copy and create thread', exact: true }).click()
    const worktreeStart = await page.evaluate(
      () => window.calls.filter((call) => call.path.endsWith('/start')).at(-1).input,
    )
    assert.equal(worktreeStart.worktreePath, '/worktrees/feature')
    assert.deepEqual(worktreeStart.destination, { parentDirectory: '/projects' })
    assert.deepEqual(worktreeStart.ignoredFiles, [])
    assert.equal(worktreeStart.thread.prompt, 'Continue reviewing these changes')
    assert.equal(worktreeStart.thread.title, 'Continue reviewing these changes')
    assert(
      await page.evaluate(() =>
        window.calls.some(
          (call) =>
            call.path.endsWith('/inspect') && call.input.worktreePath === '/worktrees/feature',
        ),
      ),
    )
    await page.evaluate(() =>
      window.setJob({
        state: 'completed',
        targetTaskId: 'copied-thread',
        threadStartError: 'Agent not installed',
      }),
    )
    await page.getByText('Thread created on Desktop.', { exact: true }).waitFor()
    await page.getByRole('alert').filter({ hasText: 'Agent not installed' }).waitFor()
    await page.getByRole('button', { name: 'Open thread on Desktop', exact: true }).click()
    assert.deepEqual(
      await page.evaluate(() => window.opened),
      mobile
        ? ['tasks', 'copied-thread', 'destination']
        : { viewId: 'tasks', entityId: 'copied-thread' },
    )
    // Thread entry resolves the exact owned worktree and starts a fresh destination thread.
    await page.evaluate(() => {
      window.setJob({ state: 'cancelled' })
      window.noDestinationProject = false
      window.setSource({
        id: 'reused',
        repositoryId: 'project',
        execution: 'worktree',
        checkoutBranch: 'feature',
      })
    })
    await page.getByLabel('Source checkout').waitFor()
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Source checkout"]')?.value === '/worktrees/feature',
    )
    assert.equal(
      await page
        .getByRole('checkbox', { name: 'Create a thread on destination', exact: true })
        .isChecked(),
      true,
    )
    await page.getByRole('button', { name: 'Copy and create thread', exact: true }).click()
    assert.equal(
      await page.evaluate(
        () => window.calls.filter((call) => call.path.endsWith('/start')).at(-1).input.worktreePath,
      ),
      '/worktrees/feature',
    )
    assert.deepEqual(
      await page.evaluate(
        () => window.calls.filter((call) => call.path.endsWith('/start')).at(-1).input.destination,
      ),
      { repositoryId: 'destination-project' },
    )
    // Missing worktrees never silently copy the project checkout instead.
    await page.evaluate(() => {
      window.missingWorktree = true
      window.setJob({ state: 'cancelled' })
      window.setSource({
        id: 'missing',
        repositoryId: 'project',
        execution: 'worktree',
        checkoutBranch: 'missing',
      })
    })
    await page
      .getByText('This thread’s worktree is no longer available.', { exact: true })
      .waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Copy and create thread', exact: true }).isDisabled(),
      true,
    )
    // Explicit registered worktrees do not require Dovo ownership; inspection validates them.
    await page.evaluate(() =>
      window.setSource({
        id: 'external',
        repositoryId: 'project',
        execution: 'worktree',
        existingWorktreePath: '/worktrees/feature',
      }),
    )
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Source checkout"]')?.value === '/worktrees/feature',
    )
    await page.getByRole('button', { name: 'Copy and create thread', exact: true }).waitFor()
    // Project-folder threads must open the copy flow without looking up a worktree.
    await page.evaluate(() => {
      window.calls = []
      window.setSource({ id: 'main-copy', repositoryId: 'project', execution: 'main' })
    })
    await page
      .getByRole('dialog', mobile ? { name: 'Copy project checkout to another machine' } : {})
      .waitFor()
    const copyThread = page.getByRole('button', { name: 'Copy and create thread', exact: true })
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent === 'Copy and create thread' && !button.disabled,
      ),
    )
    assert.equal(await page.getByLabel('Destination computer').inputValue(), 'machine-b')
    assert.equal(
      await page.evaluate(() =>
        window.calls.some((call) => call.path === '/api/scm/worktrees/read'),
      ),
      false,
    )
    await copyThread.click()
    const mainCopy = await page.evaluate(
      () => window.calls.find((call) => call.path.endsWith('/start')).input,
    )
    assert.equal(mainCopy.worktreePath, undefined)
    assert.equal(mainCopy.targetId, 'machine-b')
    assert.ok(mainCopy.thread)
    await page.getByRole('button', { name: 'Cancel copy', exact: true }).click()
    await page.getByText('Copy cancelled', { exact: true }).waitFor()
    if (!mobile) {
      await page.evaluate(() => {
        window.calls = []
        window.savedSsh = 'ssh://shared-user@shared-host:2222'
        window.setSource({ id: 'main-thread', repositoryId: 'project', execution: 'main' })
      })
      await page.waitForFunction(() => window.calls.some((call) => call.path.endsWith('/inspect')))
      await page
        .getByRole('dialog')
        .getByText('Copy project checkout to another machine', { exact: true })
        .waitFor()
      await page.getByRole('button', { name: 'Copy and create thread', exact: true }).waitFor()
      await page.getByLabel('Project copy connection').selectOption('ssh')
      assert.equal(
        await page.getByRole('textbox', { name: 'SSH user', exact: true }).inputValue(),
        'shared-user',
      )
      assert.equal(
        await page.getByRole('textbox', { name: 'SSH host', exact: true }).inputValue(),
        'shared-host',
      )
      assert.equal(
        await page.getByRole('textbox', { name: 'SSH port', exact: true }).inputValue(),
        '2222',
      )
      await page.getByRole('button', { name: 'Copy and create thread', exact: true }).click()
      const input = await page.evaluate(
        () => window.calls.filter((call) => call.path.endsWith('/start')).at(-1).input,
      )
      assert.equal(input.worktreePath, undefined)
      assert.equal(input.ssh.sshHost, 'shared-host')
      await page.evaluate(() => {
        window.truncated = false
        window.previewTransfer()
      })
      await page.getByRole('dialog', { name: 'Add to another machine' }).waitFor()
      await page
        .getByRole('button', { name: 'Copy project', exact: true })
        .waitFor({ state: 'visible' })
      mkdirSync(root + 'work/dialogs', { recursive: true })
      const panel = page.locator('.project-transfer-panel')
      const actions = page.locator('.project-transfer-actions')
      const panelBox = await panel.boundingBox()
      const actionsBox = await actions.boundingBox()
      assert.ok(
        actionsBox.y >= panelBox.y + panelBox.height,
        'Copy actions sit below the inset panel',
      )
      await page.screenshot({ path: root + 'work/dialogs/project-transfer.png' })
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 700 })
        const modal = page.getByRole('dialog')
        assert.equal(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth), true)
        await page
          .getByRole('button', { name: 'Copy project', exact: true })
          .scrollIntoViewIfNeeded()
        await page.screenshot({ path: root + 'work/dialogs/project-transfer-' + width + '.png' })
      }
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    }
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      `${mobile ? 'Mobile' : 'Desktop'} project copy: P2P, SSH validation, private files, progress, cancellation, saved retry and offline/capability checks pass.`,
    )
  }
} finally {
  await browser.close()
}
