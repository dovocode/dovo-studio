import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const mobile = root + '/apps/mobile/src/ui/content'
const built = await bundleBrowser(
  {
    stdin: {
      contents: `
    import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {ArtifactSharing as Desktop} from '${root}/packages/extension-tasks/src/chat/artifact-sharing';
    import {ArtifactSharing as Mobile} from '${mobile}/artifact-sharing';
    const app=createRoot(document.getElementById('app'));let round=0;let kind;
    window.render=()=>flushSync(()=>app.render(kind==='desktop'?<Desktop key={round} artifact={window.artifact}/>:<Mobile key={round} artifact={window.artifact}/>));
    window.reset=value=>{
      round++;kind=value;window.uploads=[];window.opened=[];window.consent=null;window.session='owner-session';window.fail=false;window.feedCalls=[];window.feedWrites=[];window.feedEnabled=false;window.runtimeId='computer-one';
      window.artifact={id:'3ef552ad-eac4-4e4b-b7de-9f530b267879',taskId:'private-thread',revision:7,title:'Quarterly report',format:'html',content:'<h1>Report</h1>',createdAt:'2026-10-21',updatedAt:'2026-10-21'};
      window.account={loaded:true,busy:false,deletionPending:false,error:'',directory:{user:{id:'owner',name:'Owner'}},client:{
        sessionId:()=>window.session,
        artifactService:async()=> 'https://artifacts.example.com',
        publishArtifact:async(artifact,origin)=>{window.uploads.push({id:artifact.id,revision:artifact.revision,origin,session:window.session});if(window.fail)throw Error('Publication failed');return {publicationId:'3ef552ad-eac4-4e4b-b7de-9f530b267879',url:'https://artifacts.example.com/s/private',manageUrl:'https://artifacts.example.com/manage/private#session=scoped-session'}},
        enableArtifactFeed:async(id,origin,seconds,data,enable)=>{window.feedWrites.push({id,origin,seconds,data});await enable({token:'writer'});return {generation:'3ef552ad-eac4-4e4b-b7de-9f530b267880'}},
        stopArtifactFeed:async()=>{window.feedWrites.push({stop:true})},
      }};
      window.workspace={connected:true,activeRuntimeId:window.runtimeId,request:async(path,input)=>{
        window.feedCalls.push({path,input});
        if(path.endsWith('/tools'))return {tools:[{server:'reports',tool:'summary',description:'Read a report',inputSchema:{type:'object'}}]};
        if(path.endsWith('/preview'))return {previewId:'3ef552ad-eac4-4e4b-b7de-9f530b267881',data:{count:3}};
        if(path.endsWith('/enable'))window.feedEnabled=true;
        if(path.endsWith('/stop'))window.feedEnabled=false;
        return {enabled:window.feedEnabled,error:''};
      }};
      window.host={accountStorage:{},openExternalLink:async url=>{window.opened.push(url)}};window.render();
    };window.reset('desktop');
  `,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { react: root + '/packages/studio-ui/node_modules/react' },
    nodePaths: [root + '/packages/studio-ui/node_modules'],
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export {useArtifactFeed} from '${root}/packages/studio-core/src/use-artifact-feed';export const useWorkspace=()=>window.workspace;export const useStudioHost=()=>window.host;export const useAccount=()=>window.account;`,
    },
    {
      path: '@dovo/studio-ui',
      contents: `
    export const Button=({children,onClick,disabled,...props})=><button onClick={onClick} disabled={disabled} aria-label={props['aria-label']}>{children}</button>;
    export const Input=props=><input {...props}/>;export const Textarea=props=><textarea {...props}/>;
    export const Dialog=({open,children})=>open?<div role="dialog">{children}</div>:null;
    export const DialogContent=({children})=><div>{children}</div>;
    export const DialogTitle=({children})=><h2>{children}</h2>;
    export const DialogDescription=({children})=><p>{children}</p>;
  `,
    },
    {
      path: '@dovo/studio-ui/clipboard',
      contents: 'export const copyTextToClipboard=async text=>{window.copied=text};',
    },
    {
      path: '../../runtime/connection/account-provider',
      importer: mobile,
      contents: 'export const useMobileAccount=()=>window.account;',
    },
    {
      path: '../../runtime/connection/provider',
      importer: mobile,
      contents:
        'export const useRuntime=()=>({call:window.workspace.request,connected:window.workspace.connected,activeId:window.workspace.activeRuntimeId});',
    },
    {
      path: 'react-native',
      contents: `
    export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;
    export const ScrollView=({children})=><div>{children}</div>;
    export const Linking={openURL:async url=>window.opened.push(url)};
    export const Alert={alert:(title,message,buttons)=>{window.consent={title,message};window.confirmMobile=()=>buttons.find(button=>button.text!=='Cancel').onPress()}};
  `,
    },
    {
      path: '../controls/action',
      importer: mobile,
      contents:
        'export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;',
    },
    {
      path: './text',
      importer: mobile,
      contents:
        'export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;',
    },
    {
      path: '../controls/field',
      importer: mobile,
      contents:
        'export const Field=({label,value,onChangeText})=><label>{label}<input aria-label={label} value={value} onChange={e=>onChangeText(e.target.value)}/></label>;',
    },
    {
      path: '../controls/choice',
      importer: mobile,
      contents:
        'export const Choice=({label,value,onChange,items,disabled})=><label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;',
    },
    { path: '../theme', importer: mobile, contents: 'export const useTheme=()=>({styles:{}});' },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  for (const kind of ['desktop', 'mobile']) {
    await page.evaluate((kind) => window.reset(kind), kind)
    if (kind === 'desktop')
      await page.getByRole('button', { name: 'Share artifact', exact: true }).click()
    await page.getByText('https://artifacts.example.com', { exact: false }).waitFor()
    assert.equal(await page.evaluate(() => window.uploads.length), 0)
    await page.getByRole('button', { name: 'Publish private copy', exact: true }).click()
    if (kind === 'mobile') {
      assert.equal(await page.evaluate(() => window.uploads.length), 0)
      const consent = await page.evaluate(() => window.consent)
      assert.match(
        consent.message,
        /Quarterly report.*version 7.*https:\/\/artifacts.example.com as Owner/,
      )
      await page.evaluate(() => {
        window.session = 'different-account'
        window.confirmMobile()
      })
      await page.getByRole('alert').filter({ hasText: 'Account changed' }).waitFor()
      assert.equal(await page.evaluate(() => window.uploads.length), 0)
      await page.evaluate(() => {
        window.session = 'owner-session'
        window.render()
      })
      await page.getByRole('button', { name: 'Publish private copy', exact: true }).click()
      await page.evaluate(() => window.confirmMobile())
    }
    await page.getByText('Private copy published.', { exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.uploads), [
      {
        id: '3ef552ad-eac4-4e4b-b7de-9f530b267879',
        revision: 7,
        origin: 'https://artifacts.example.com',
        session: 'owner-session',
      },
    ])
    await page.getByRole('button', { name: 'Manage invitations and links', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.opened), [
      'https://artifacts.example.com/manage/private#session=scoped-session',
    ])
    if (kind === 'desktop') {
      await page.getByRole('button', { name: 'Copy private link', exact: true }).click()
      assert.equal(
        await page.evaluate(() => window.copied),
        'https://artifacts.example.com/s/private',
      )
    }
    await page.getByRole('button', { name: 'Load read-only MCP tools', exact: true }).click()
    await page.getByRole('button', { name: 'Read preview', exact: true }).click()
    await page.getByRole('button', { name: 'Approve and enable live feed', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.feedWrites.length), 0)
    await page.getByLabel('JSON field to share', { exact: true }).fill('/summary')
    assert.equal(
      await page.getByRole('button', { name: 'Approve and enable live feed', exact: true }).count(),
      0,
    )
    await page.getByRole('button', { name: 'Read preview', exact: true }).click()
    await page.getByRole('button', { name: 'Approve and enable live feed', exact: true }).click()
    if (kind === 'mobile') {
      assert.equal(await page.evaluate(() => window.feedWrites.length), 0)
      assert.match(
        (await page.evaluate(() => window.consent)).message,
        /reports.*summary.*future results/,
      )
      await page.evaluate(() => window.confirmMobile())
    }
    await page.getByRole('button', { name: 'Stop and clear live feed', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.feedWrites), [
      {
        id: '3ef552ad-eac4-4e4b-b7de-9f530b267879',
        origin: 'https://artifacts.example.com',
        seconds: 60,
        data: { count: 3 },
      },
    ])
    assert.equal(
      await page.evaluate(
        () => window.feedCalls.filter((call) => call.path.endsWith('/enable')).length,
      ),
      1,
    )
    await page.getByRole('button', { name: 'Stop and clear live feed', exact: true }).click()
    await page.getByRole('button', { name: 'Load read-only MCP tools', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Read preview', exact: true }).click()
    await page.getByRole('button', { name: 'Approve and enable live feed', exact: true }).waitFor()
    if (kind === 'mobile')
      await page.getByRole('button', { name: 'Approve and enable live feed', exact: true }).click()
    await page.evaluate(() => {
      window.workspace.activeRuntimeId = 'different-computer'
      window.render()
    })
    await page.waitForFunction(() => !document.querySelector('[aria-label="MCP query"]'))
    if (kind === 'mobile') await page.evaluate(() => window.confirmMobile())
    assert.equal(
      await page.evaluate(() => window.feedWrites.filter((call) => !call.stop).length),
      1,
    )
    await page.evaluate(() => {
      window.session = 'new-session'
      window.render()
    })
    await page.getByRole('button', { name: 'Publish private copy', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Manage invitations and links', exact: true }).count(),
      0,
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'Desktop/mobile sharing controls: explicit publication, selected revision, named destination/account, native confirmation and account-change protection passed.',
  )
} finally {
  await browser.close()
}
