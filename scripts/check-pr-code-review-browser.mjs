import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const screenshots = process.env.DOVO_REVIEW_SCREENSHOTS || join(root, 'output/pr-review-checks')
await mkdir(screenshots, { recursive: true })
const fixture = `
const head='a'.repeat(40),base='b'.repeat(40);
const taskTimer=window.setTimeout.bind(window);window.setTimeout=(callback,delay,...args)=>taskTimer(callback,delay===20000?100:delay,...args);
const selection={harness:{provider:'claude',endpoint:''},agentId:'',model:'Review model',reasoning:''};
const finding={id:'bug',path:'src/drafts.ts',line:122,side:window.firstUse?'before':'after',severity:'high',title:'Restore clears a valid draft',trigger:'Reconnect while the saved draft is unavailable.',impact:'The current draft is lost.',suggestion:'Keep the current draft until restore succeeds.',anchored:true,evidence:'  clearDraft();',confidence:9,verification:'Clearing before restore loses the current draft.'};
const patch='@@ -1,123 +1,123 @@\\n'+Array.from({length:120},(_,index)=>' // context '+(index+1)+'\\n').join('')+' export async function restore() {\\n-  await saveDraft();\\n+  clearDraft();\\n }\\n';
let report={reviews:[],...(window.firstUse?{}:{selection})};const reports=new Map([['runtime',report]]);window.requests=[];
window.changeSavedDecision=()=>{const r=(reports.get(window.firstUse?'remote':'runtime')??report).reviews[0];r.draft.event='request-changes';r.version++;r.sequence++};
window.combineReview=()=>{const r=(reports.get(window.firstUse?'remote':'runtime')??report).reviews[0];r.status='running';r.analysis.phase='combining';delete r.analysis.activeBatch;r.sequence++};window.progressReview=()=>{const r=(reports.get(window.firstUse?'remote':'runtime')??report).reviews[0];r.status='running';r.analysis.phase='checking';r.analysis.activeBatch=2;r.analysis.completedBatches=0;r.sequence++};
window.finishProgress=()=>{const r=(reports.get(window.firstUse?'remote':'runtime')??report).reviews[0];r.status='completed';r.analysis.phase='completed';delete r.analysis.activeBatch;r.analysis.completedBatches=2;r.sequence++};
window.transport=async(path,input,host='runtime')=>{
 window.requests.push({path,input:structuredClone(input),host});
 if(path.endsWith('/start')&&window.delayStart)await new Promise(resolve=>window.releaseStart=resolve);
 if(path.endsWith('/identity'))return {readerIdentity:'reader-'+host,destination:'destination-'+host};
 if(path==='/api/scm/pulls/detail')return {...detail,destination:'destination-'+host,pull:{...detail.pull,connectionId:'account-'+host,headSha:window.staleRemote?'stale':head}};
 if(!reports.has(host))reports.set(host,{reviews:[],...(window.firstUse?{}:{selection})});const report=reports.get(host);
 if(path.endsWith('/start'))report.reviews.unshift({id:input.requestId,requestId:input.requestId,revision:'evidence',version:0,sequence:0,url:'https://github.com/acme/studio/pull/184',destination:'destination',readerIdentity:'reader',account:'dominic',baseSha:base,headSha:head,selection:input.selection,reviewers:input.reviewers,images:(input.images??[]).map((image,index)=>({id:'image-'+index,name:image.name,mime:'image/png',digest:'hash',size:68})),reviewerResults:[input.selection,...(input.reviewers??[])].map((selection,index)=>({id:'reviewer-'+(index+1),selection,status:'completed',completedBatches:2,batches:2})),depth:input.depth,runChecks:input.runChecks,checks:input.runChecks?[{name:"lint",command:"pnpm run lint",headSha:head,status:"failed",exitCode:2,output:"Actual lint output"}]:[],createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),status:'completed',summary:'One bug needs a closer look.',analysis:{batches:2,completedBatches:2,phase:'completed',rejectedFindings:3,contextFiles:[{path:'src/store.ts',ref:head,text:'export const snapshotOnly = true;'}]},notVerified:['No tests ran. Only supplied patches were available.'],coverage:[{path:'src/drafts.ts',state:'supplied',patch},{path:'assets/logo.png',state:'excluded'}],missingFiles:0,findings:[{...finding,reviewerIds:['reviewer-1']}],draft:{body:'',selected:[],dismissed:[],event:'comment'}});
 if(path.endsWith('/start')){report.selection=input.selection;report.reviewers=input.reviewers;}
 if(path.endsWith('/start')&&input.fullStack)report.stacks=[{id:'stack-run',sequence:1,requestId:input.requestId,status:'running',createdAt:new Date().toISOString(),members:[183,184].map((number,index)=>({target:{...input.target,number},url:'https://github.com/acme/studio/pull/'+number,title:'Stack member '+number,status:index?'queued':'running',reviewId:index?undefined:'root-review',suppliedFiles:1,totalFiles:2,findings:1}))}];
 if(path.endsWith('/stop')&&input.stackId){report.stacks[0].status='cancelled';report.stacks[0].sequence++;report.stacks[0].members.forEach(member=>member.status='cancelled');}
 if(path.endsWith('/save')){if(window.delaySave)await new Promise(resolve=>window.releaseSave=resolve);const r=report.reviews.find(r=>r.id===input.reviewId);if(r.version!==input.version)throw new Error('This draft changed on another client.');r.draft=structuredClone(input.draft);r.version++;r.sequence++}
 if(path.endsWith('/publish')){if(window.failPublish){window.failPublish=false;throw new Error('Publish response unavailable. Check the report before retrying.')}if(window.delayPublish)await new Promise(resolve=>window.releasePublish=resolve);const r=report.reviews.find(r=>r.id===input.reviewId);r.publication={requestId:input.requestId,body:input.body,event:r.draft.event,status:'published',url:r.url+'#review-1'};r.sequence++}
 return structuredClone(report);
};
const detail={destination:'destination',pull:{number:184,title:'Preserve drafts after reconnect',headSha:head,baseSha:base,url:'https://github.com/acme/studio/pull/184'},files:[]};
detail.stack={rootNumber:183,position:2,size:2,complete:true,members:[183,184].map((number,index)=>({number,title:'Stack member '+number,url:'https://github.com/acme/studio/pull/'+number,head:'feature-'+number,base:index?'feature-183':'main',draft:false,depth:index,...(index?{parentNumber:183}:{})}))};
`
const mobileRoot = root + 'apps/mobile/src/scm/pulls/detail'
const mobileMocks = [
  {
    path: 'expo-image-picker',
    contents: `export const launchImageLibraryAsync=async()=>({canceled:false,assets:[{uri:'fixture:image',fileName:'mobile-shot.png',mimeType:'image/png'}]});`,
  },
  {
    path: 'expo-file-system',
    contents: `export class File{size=68;async base64(){return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}}`,
  },
  {
    path: '../../../tasks/composer/optimize-attachment-image',
    importer: mobileRoot,
    contents: `export const optimizeAttachmentImage=async asset=>asset;`,
  },
  {
    path: '../../../tasks/preview/diff-view',
    importer: mobileRoot,
    contents: `export const DiffView=({patch,focusedLine,focusedSide})=><pre data-line={focusedLine} data-side={focusedSide}>{patch}</pre>;`,
  },
  {
    path: 'react-native',
    contents: `import {useRef} from 'react';export const Easing={ease:x=>x,inOut:x=>x};class Value{constructor(value){this.value=value}setValue(value){this.value=value}interpolate({outputRange}){return outputRange[0]}};export const Animated={Value,View:({style,children})=><div>{children}</div>,loop:()=>({start(){},stop(){}}),sequence:x=>x,timing:()=>({})};const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s;export const View=({style,children})=><div style={{display:'flex',flexDirection:'column',minWidth:0,...flat(style)}}>{children}</div>;export const Text=({style,children})=><span style={flat(style)}>{children}</span>;export const Linking={openURL:async url=>{window.openedURL=url}};export const Image=({source,style})=><img alt="" src={source.uri} style={style}/>;export const ScrollView=({children})=><div style={{overflow:'auto'}}>{children}</div>;`,
  },
  {
    path: '../../../runtime/connection/provider',
    importer: mobileRoot,
    contents: `import {createContext,useContext} from 'react';const Scope=createContext('runtime');const overviews=['runtime','remote'].map(id=>({profile:{id,name:id,connection:{address:'http://'+id,token:id}},connected:true,snapshot:{workspace:{repositories:[],agents:[]}}}));export const RuntimeScope=({runtimeId,children})=><Scope.Provider value={runtimeId}>{children}</Scope.Provider>;const requests=new Map(overviews.map(({profile})=>[profile.id,(path,input)=>window.transport(path,input,profile.id)]));export const useRuntime=()=>{const id=useContext(Scope),call=requests.get(id);return {call,read:call,overviews,connected:window.offlineHost!==id,profile:overviews.find(x=>x.profile.id===id).profile,snapshot:{acpInstallations:[{id:'review-acp',name:'Review ACP client'}],runtimeId:id,workspace:{agents:[],repositories:[]}}}};`,
  },
  {
    path: '../../../agents/model-settings',
    importer: mobileRoot,
    contents: `export const LineCommentForm=()=>null;export const ModelSettings=({agent,onChange})=><label>Reviewer model<select aria-label="Reviewer model" value={agent.model} onChange={e=>onChange({...agent,model:e.target.value})}><option value="">Choose a model</option><option value="Review model">Review model</option><option value="Second model">Second model</option></select></label>;`,
  },
  {
    path: '../../../tasks/creation/harness-choices',
    importer: mobileRoot,
    contents: `export const harnessNames={claude:'Claude'};`,
  },
  {
    path: '../../../ui/controls/action',
    importer: mobileRoot,
    contents: `export const Action=({label,onPress,disabled,secondary,wide})=><button className={secondary?'mobile-secondary':'mobile-action'} style={{alignSelf:wide?'stretch':'flex-start'}} disabled={disabled} onClick={onPress}>{label}</button>;`,
  },
  {
    path: '../../../ui/controls/choice',
    importer: mobileRoot,
    contents: `export const Choice=({label,value,items,onChange,disabled})=><label className="mobile-choice">{label}<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;`,
  },
  {
    path: '../../../ui/controls/field',
    importer: mobileRoot,
    contents: `export const Field=({label,value,onChangeText,editable,maxLength})=><label>{label}<textarea aria-label={label} value={value} disabled={editable===false} maxLength={maxLength} onChange={e=>onChangeText(e.target.value)}/></label>;`,
  },
  {
    path: '../../../ui/content/text',
    importer: mobileRoot,
    contents: `export const Text=({style,children,selectable})=><p style={{margin:0,...(Array.isArray(style)?Object.assign({},...style):style)}}>{children}</p>;`,
  },
  {
    path: '../../../ui/layout/sheet',
    importer: mobileRoot,
    contents: `import { useImperativeHandle, useLayoutEffect, useRef } from 'react';
    export function Sheet({title,children,onClose,footer,scrollViewProps}) {
      const body=useRef(null);
      useImperativeHandle(scrollViewProps?.ref,()=>({scrollTo:({y})=>{body.current.scrollTop=y}}),[]);
      useLayoutEffect(()=>{scrollViewProps?.onContentSizeChange?.()},[title]);
      return <section role="dialog" aria-label={title} className="mobile-sheet"><header><h2>{title}</h2><button onClick={onClose}>Close</button></header><div ref={body} className="mobile-sheet-body" onScroll={event=>scrollViewProps?.onScroll?.({nativeEvent:{contentOffset:{y:event.currentTarget.scrollTop}}})}>{children}</div>{footer&&<footer>{footer}</footer>}</section>;
    }`,
  },
  {
    path: '../../../ui/theme',
    importer: mobileRoot,
    contents: `export const useTheme=()=>({reduceMotion:false,colors:{accent:'#77b8a8',border:'#303438',text:'#e9edee',muted:'#9ba5aa',error:'#f08080'},styles:{row:{flexDirection:'row',alignItems:'center'},card:{border:'1px solid #303438',borderRadius:10,padding:14,background:'#191d20'},text:{color:'#e9edee',fontSize:14,lineHeight:'22px'},muted:{color:'#9ba5aa',fontSize:13,lineHeight:'21px'},error:{color:'#f08080'}}});`,
  },
]
const desktopMocks = [
  {
    path: '@dovo/studio-core',
    contents: `import {createContext,useContext} from 'react';export {forgeLabels,pullFilePatch} from '@dovo/protocol';const Scope=createContext('runtime');const computers=['runtime','remote'].map(id=>({name:id,profile:{id,name:id,connection:{address:'http://'+id,token:id}},connected:true}));const requests=new Map(computers.map(({profile})=>[profile.id,(path,input)=>window.transport(path,input,profile.id)]));export const useAppPreferences=()=>({motion:window.reduceMotion?'reduce':'system'});export const providers=new Proxy({},{get:(_,key)=>({short:String(key)})});export const useRuntimeSources=()=>computers;export const WorkspaceRuntimeScope=({runtimeId,children})=><Scope.Provider value={runtimeId}>{children}</Scope.Provider>;export const useWorkspace=()=>{const id=useContext(Scope);return {request:requests.get(id),connected:window.offlineHost!==id,activeRuntimeId:id,connection:computers.find(x=>x.profile.id===id).profile.connection,workspace:{agents:[],repositories:[]},snapshot:{defaults:{},acpInstallations:[{id:'review-acp',name:'Review ACP client'}]}}};`,
  },
  {
    path: '@dovo/studio-ui/code-themes',
    contents: `export const useDiffOptions=()=>({options:{}});export const preloadStudioHighlighter=async()=>{};`,
  },
  {
    path: '@dovo/studio-ui',
    contents: `export {Button} from '${root}packages/studio-ui/src/components/ui/button';export {ChoicePicker} from '${root}packages/studio-ui/src/choice-picker';export {Textarea} from '${root}packages/studio-ui/src/components/ui/textarea';export {Dialog,DialogContent,DialogTitle,DialogDescription} from '${root}packages/studio-ui/src/components/ui/dialog';export const LineCommentForm=()=>null;export const ModelSettings=({agent,onChange})=><label>Reviewer model<select aria-label="Reviewer model" value={agent.model} onChange={e=>onChange({...agent,model:e.target.value})}><option value="">Choose a model</option><option value="Review model">Review model</option><option value="Second model">Second model</option></select></label>;`,
  },
]
const browser = await chromium.launch()
try {
  for (const mobile of [false, true])
    for (const firstUse of [false, true]) {
      const component = mobile ? 'MobilePullCodeReview' : 'PullCodeReviewPanel'
      const path = mobile
        ? 'apps/mobile/src/scm/pulls/detail/code-review.tsx'
        : 'packages/extension-scm/src/pulls/detail/code-review.tsx'
      const built = await bundleBrowser(
        {
          stdin: {
            resolveDir: root,
            loader: 'tsx',
            contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {claimPullReviewRequest,createPullReviewRequest} from '${root}apps/mobile/src/scm/pulls/list/pull-route-number.ts';import {${component}} from '${root}${path}';${fixture}const rowToken=window.rowReview&&createPullReviewRequest('runtime','repo',184);const rowReviewRun=rowToken?()=>claimPullReviewRequest(rowToken,'runtime','repo',184):undefined;function App(){const [headSha,setHead]=useState(head);const [,refresh]=useState(0);window.refreshComputers=()=>refresh(n=>n+1);window.push=()=>setHead('c'.repeat(40));return <${component} initiallyOpen={!!rowToken} rowReviewRun={rowReviewRun} repositoryId="repo" detail={{...detail,pull:{...detail.pull,headSha}}} onAsk={value=>window.asked=value} onOpenStackReview={(member,runtimeId)=>window.stackOpened={member,runtimeId}}/>};createRoot(document.getElementById('app')).render(<App/>);`,
          },
          bundle: true,
          write: false,
          format: 'iife',
          jsx: 'automatic',
          platform: 'browser',
          alias: {
            react: root + 'packages/studio-ui/node_modules/react',
            '@dovo/protocol': root + 'packages/protocol/src/index.ts',
          },
          nodePaths: [root + 'packages/studio-ui/node_modules', root + 'node_modules'],
        },
        mobile ? mobileMocks : desktopMocks,
      )
      const page = await browser.newPage({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 1000 },
      })
      const errors = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
        console.error(error.stack)
      })
      page.setDefaultTimeout(10000)
      await page.setContent('<body class="studio dark"><main id="app"></main></body>')
      for (const name of (await readdir(root + 'apps/desktop/dist/assets')).filter((name) =>
        name.endsWith('.css'),
      ))
        await page.addStyleTag({
          content: await readFile(root + 'apps/desktop/dist/assets/' + name, 'utf8'),
        })
      await page.addStyleTag({
        content: `body{display:block;margin:0;padding:24px;background:#101416;color:#e9edee;font-family:system-ui}#app{width:100%;max-width:1280px;margin:auto}body:before{content:'Dovo Studio / Pull requests / #184  ·  Test fixture';display:block;color:#849198;font-size:12px;margin-bottom:16px}.mobile-sheet{position:absolute;inset:0;overflow:auto;background:#111619;padding:18px;display:flex;flex-direction:column;gap:16px}.mobile-sheet-body{overflow:auto;min-height:0;flex:1;display:flex;flex-direction:column;gap:14px}.mobile-sheet footer{flex-shrink:0;border-top:1px solid #303438;padding-top:12px}.mobile-sheet header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #303438;padding-bottom:12px}.mobile-sheet h2{font-size:16px}.mobile-action,.mobile-secondary{min-height:44px;padding:10px 14px;border-radius:8px;background:#87dcb1;color:#10231a;font-size:13px}.mobile-secondary{background:#20282c;color:#d7e3e0;border:1px solid #35413f}.mobile-choice{display:flex;flex-direction:column;gap:6px;font-size:12px}select,textarea{max-width:100%;background:#20272b;color:#e6eded;border:1px solid #34413f;padding:8px;border-radius:6px}textarea{width:100%;min-height:130px}button:disabled{opacity:.45}`,
      })
      await page.evaluate((value) => (window.firstUse = value), firstUse)
      await page.addScriptTag({ content: built.outputFiles[0].text })
      const entry = page.getByRole('button', {
        name: mobile
          ? firstUse
            ? 'Set up agent review'
            : 'Run agent review'
          : 'Start agent review',
        exact: true,
      })
      await entry.waitFor()

      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Review controls must fit the viewport',
      )
      if (!firstUse)
        await page.screenshot({
          path: screenshots + (mobile ? '/mobile-empty.png' : '/desktop-empty.png'),
          fullPage: true,
        })
      if (firstUse) {
        if (mobile)
          await page
            .getByRole('combobox', { name: 'Review on computer', exact: true })
            .selectOption('remote')
        else {
          await page.getByRole('button', { name: 'Review on computer', exact: true }).click()
          await page.getByRole('option', { name: 'remote', exact: true }).click()
        }
        await entry.waitFor()
        if (mobile)
          await page.getByRole('button', { name: 'Configure this run', exact: true }).click()
        if (mobile)
          await page
            .getByRole('combobox', { name: 'Reviewer provider', exact: true })
            .selectOption('acp:review-acp')
        else {
          await page.getByRole('button', { name: 'Reviewer provider', exact: true }).click()
          await page.getByRole('option', { name: 'Review ACP client · ACP', exact: true }).click()
        }
        await page.getByRole('combobox', { name: 'Reviewer model', exact: true }).waitFor()
        const start = page.getByRole('button', {
          name: 'Start agent review',
          exact: true,
        })
        assert.equal(await start.isDisabled(), true)
        await page
          .getByRole('combobox', { name: 'Reviewer model', exact: true })
          .selectOption('Review model')
        await page.getByRole('button', { name: 'Add reviewer', exact: true }).click()
        await page
          .getByRole('combobox', { name: 'Reviewer model', exact: true })
          .nth(1)
          .selectOption('Second model')
        if (mobile) await page.getByRole('button', { name: 'Add images', exact: true }).click()
        else
          await page.locator('input[type=file]').setInputFiles({
            name: 'desktop-shot.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
              'base64',
            ),
          })
        await page
          .getByText(mobile ? 'mobile-shot.png' : 'desktop-shot.png', { exact: true })
          .waitFor()
        await start.click()
        const multiStart = await page.evaluate(
          () => window.requests.find((r) => r.path.endsWith('/start')).input,
        )
        assert.equal(multiStart.selection.harness.acpInstallationId, 'review-acp')
        assert.equal(multiStart.selection.harness.provider, 'acp')
        assert.equal(multiStart.reviewers[0].model, 'Second model')
        assert.equal(multiStart.images.length, 1)
        assert.equal(multiStart.target.repositoryId, 'https://github.com/acme/studio/pull/184')
        assert.equal(multiStart.target.connectionId, 'account-remote')
        assert.equal(multiStart.target.expectedDestination, 'destination-remote')
        assert.equal(
          await page.evaluate(() => window.requests.find((r) => r.path.endsWith('/start')).host),
          'remote',
        )
      } else {
        if (mobile)
          await page.getByRole('button', { name: 'Configure this run', exact: true }).click()
        if (mobile) {
          await page
            .getByRole('combobox', { name: 'Review depth', exact: true })
            .selectOption('thorough')
          await page
            .getByRole('combobox', { name: 'Run project checks', exact: true })
            .selectOption('yes')
        } else {
          await page.getByRole('button', { name: 'Review model', exact: true }).click()
          await page.getByRole('button', { name: 'Review depth', exact: true }).click()
          await page.getByRole('option', { name: 'Deep', exact: true }).click()
          await page.getByRole('checkbox', { name: 'Run project checks', exact: true }).check()
        }
        await page.evaluate(() => {
          window.delayStart = true
        })
        await page.getByRole('button', { name: 'Start agent review', exact: true }).click()
        await page.getByText('Preparing review…', { exact: true }).waitFor()
        await page.screenshot({
          path: screenshots + '/' + (mobile ? 'mobile' : 'desktop') + '-review-preparing.png',
          fullPage: true,
        })
        await page.evaluate(() => {
          window.delayStart = false
          window.releaseStart()
        })
        const started = await page.evaluate(
          () => window.requests.find((r) => r.path.endsWith('/start')).input,
        )
        assert.equal(started.depth, 'thorough')
        assert.equal(started.runChecks, true)
        if (mobile) {
          await page
            .getByRole('button', { name: 'View failed project checks', exact: true })
            .click()
          await page.getByText('pnpm run lint · Failed', { exact: true }).waitFor()
          await page.getByRole('button', { name: 'Show output', exact: true }).click()
        } else {
          await page.getByText('Project check results', { exact: false }).click()
          await page.getByText('pnpm run lint · Failed', { exact: true }).click()
        }
        await page.getByText('Actual lint output', { exact: true }).waitFor()
      }
      await page.getByRole('button', { name: 'Add to draft', exact: true }).waitFor()
      if (mobile) {
        const report = page.getByRole('dialog')
        await report.getByText('1 finding', { exact: true }).waitFor()
        assert.equal(
          await report.getByRole('button', { name: 'Add reviewer', exact: true }).count(),
          0,
        )
        if (!firstUse) {
          await report
            .getByRole('button', { name: 'View failed project checks', exact: true })
            .click()
          await page.screenshot({ path: join(screenshots, 'completed-review-mobile.png') })
        }
        const actions = report.getByRole('combobox', { name: 'More review actions', exact: true })
        await actions.selectOption('configure')
        await report.getByRole('button', { name: 'Add reviewer', exact: true }).waitFor()
        await actions.selectOption('configure')
      }
      if (!mobile) {
        const configure = page.getByRole('button', { name: 'Configure agent review', exact: true })
        await page.getByRole('heading', { name: '1 finding', exact: true }).waitFor()
        assert.equal(await configure.getAttribute('aria-expanded'), 'false')
        assert.equal(
          await page.getByRole('button', { name: 'Add reviewer', exact: true }).count(),
          0,
        )
        if (!firstUse) {
          await page.getByText('Project check results', { exact: false }).click()
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.screenshot({ path: join(screenshots, 'completed-review-desktop.png') })
        }
        await configure.click()
        await page.getByRole('button', { name: 'Add reviewer', exact: true }).waitFor()
        await configure.click()
        assert.equal(await configure.getAttribute('aria-expanded'), 'false')
      }
      const side = firstUse ? 'before' : 'after'
      const location = page.getByRole('button', {
        name: `src/drafts.ts:122 · ${side}`,
        exact: true,
      })
      const reportBody = page.locator('.mobile-sheet-body')
      let reportOffset
      if (mobile) {
        await page.setViewportSize({ width: 390, height: 580 })
        await location.scrollIntoViewIfNeeded()
        reportOffset = await reportBody.evaluate((body) => {
          body.scrollTop = Math.max(body.scrollTop, 32)
          body.dispatchEvent(new Event('scroll'))
          return body.scrollTop
        })
        assert.ok(reportOffset > 0)
      }
      await location.click()
      const captured = page.getByRole('dialog', { name: 'src/drafts.ts' })
      await captured
        .getByText(`Captured patch at aaaaaaa · 122 · ${side}`, { exact: true })
        .waitFor()
      if (mobile) {
        assert.equal(await captured.locator('pre').getAttribute('data-line'), '122')
        assert.equal(await captured.locator('pre').getAttribute('data-side'), side)
        await captured.getByRole('button', { name: 'Back to findings', exact: true }).click()
        assert.equal(await reportBody.evaluate((body) => body.scrollTop), reportOffset)
        await page.setViewportSize({ width: 390, height: 844 })
      } else {
        const line = captured
          .locator('[data-line="122"][data-selected-line]')
          .filter({ hasText: firstUse ? 'await saveDraft()' : 'clearDraft()' })
        await line.waitFor()
        await page.waitForFunction(
          (code) => {
            for (const container of document.querySelectorAll('[role="dialog"] diffs-container')) {
              const dialog = container.closest('[role="dialog"]')
              const lines = container.shadowRoot?.querySelectorAll(
                '[data-line="122"][data-selected-line]',
              )
              for (const line of lines ?? []) {
                if (!line.textContent.includes(code)) continue
                const bounds = line.getBoundingClientRect()
                const viewport = dialog.getBoundingClientRect()
                if (bounds.top >= viewport.top && bounds.bottom <= viewport.bottom) return true
              }
            }
            return false
          },
          firstUse ? 'await saveDraft()' : 'clearDraft()',
        )
        await captured.getByRole('button', { name: 'Close', exact: true }).click()
        assert.equal(await location.evaluate((node) => node === document.activeElement), true)
      }
      await location.waitFor()
      if (mobile) {
        await page
          .getByRole('button', { name: 'Show evidence and finding check', exact: true })
          .click()
        await page
          .getByText('Clearing before restore loses the current draft.', { exact: true })
          .waitFor()
        await page
          .getByRole('combobox', { name: 'Snapshot context', exact: true })
          .selectOption('a'.repeat(40) + 'src/store.ts')
        await page.getByText('export const snapshotOnly = true;', { exact: true }).waitFor()
        await page.getByRole('button', { name: 'Back to findings', exact: true }).click()
      } else {
        await page.getByText('Evidence and finding check', { exact: true }).click()
        await page
          .getByText('Clearing before restore loses the current draft.', { exact: true })
          .waitFor()
        await page
          .getByText('2 of 2 batches completed · 1 snapshot files · 3 findings filtered', {
            exact: true,
          })
          .click()
        await page.getByText('src/store.ts · aaaaaaa', { exact: true }).click()
        await page.getByText('export const snapshotOnly = true;', { exact: true }).waitFor()
      }
      await page.getByText('Model confidence: 9/10.', { exact: false }).waitFor()
      if (!firstUse) {
        await page.evaluate(() => window.progressReview())
        await page.getByText('Batch 2 of 2', { exact: false }).waitFor()
        await page.screenshot({
          path: screenshots + '/' + (mobile ? 'mobile' : 'desktop') + '-review-running.png',
          fullPage: true,
        })
        if (!mobile) {
          assert.ok(
            (await page
              .locator('.pr-review-motion')
              .evaluate((element) => element.getAnimations({ subtree: true }).length)) > 0,
          )
          await page.emulateMedia({ reducedMotion: 'reduce' })
          assert.equal(
            await page
              .locator('.pr-review-motion')
              .evaluate((element) => element.getAnimations({ subtree: true }).length),
            0,
          )
          await page.emulateMedia({ reducedMotion: 'no-preference' })
        }
        await page.evaluate(() => window.combineReview())
        await page.getByText('Combining reviewer findings…', { exact: true }).waitFor()
        await page.screenshot({
          path: screenshots + '/' + (mobile ? 'mobile' : 'desktop') + '-review-combining.png',
          fullPage: true,
        })
        assert.equal(
          await page.getByRole('button', { name: 'Add to draft', exact: true }).isDisabled(),
          true,
        )
        await page.evaluate(() => window.finishProgress())
      }
      assert.equal(
        await page.evaluate(
          () => window.requests.filter((r) => r.path.endsWith('/publish')).length,
        ),
        0,
      )
      await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
      const editor = page.getByRole('textbox', {
        name: mobile ? 'Your review draft' : 'Review draft',
        exact: true,
      })
      assert.ok((await editor.inputValue()).includes('Restore clears a valid draft'))
      await page.getByRole('button', { name: 'Remove from draft', exact: true }).click()
      assert.equal(await editor.inputValue(), '')
      await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
      await editor.fill('Edited finding text')
      await page.getByRole('button', { name: 'Remove from draft', exact: true }).click()
      assert.equal(await editor.inputValue(), 'Edited finding text')
      await page.getByRole('button', { name: 'Add to draft', exact: true }).click()
      await editor.fill(
        'Please check restore before clearing the draft. @reviewer https://github.com/acme/studio/pull/184',
      )
      await page.waitForFunction(() =>
        window.requests.some(
          (r) => r.path.endsWith('/save') && r.input.draft.body.startsWith('Please check'),
        ),
      )
      if (firstUse) {
        // The report and draft stay visible through a remote host outage.
        await page.evaluate(() => {
          window.offlineHost = 'remote'
          window.refreshComputers()
        })
        assert.equal(
          await editor.inputValue(),
          'Please check restore before clearing the draft. @reviewer https://github.com/acme/studio/pull/184',
        )
        await page.waitForFunction(() =>
          [...document.querySelectorAll('button')].some(
            (button) => button.textContent === 'Preview review' && button.disabled,
          ),
        )
        await page.evaluate(() => {
          delete window.offlineHost
          window.refreshComputers()
        })
        await page.getByRole('button', { name: 'Preview review', exact: true }).waitFor()
        // Reports and saved drafts follow their owning computer.
        if (mobile) await page.getByRole('button', { name: 'Close', exact: true }).click()
        const chooseComputer = async (id) => {
          if (mobile)
            await page
              .getByRole('combobox', { name: 'Review on computer', exact: true })
              .selectOption(id)
          else {
            await page.getByRole('button', { name: 'Review on computer', exact: true }).click()
            await page.getByRole('option', { name: id, exact: true }).click()
          }
        }
        await chooseComputer('runtime')
        await entry.waitFor()
        assert.equal(
          await page.getByRole('button', { name: 'Add to draft', exact: true }).count(),
          0,
        )
        await chooseComputer('remote')
        if (mobile) {
          await page.getByRole('button', { name: 'Open agent review', exact: true }).click()
        }
        await editor.waitFor()
        assert.equal(
          await editor.inputValue(),
          'Please check restore before clearing the draft. @reviewer https://github.com/acme/studio/pull/184',
        )
        assert.equal(
          await page.evaluate(
            () =>
              window.requests.filter((r) => r.path.endsWith('/start') && r.host === 'runtime')
                .length,
          ),
          0,
        )
      }
      await page
        .getByRole('button', { name: 'Preview review', exact: true })
        .waitFor({ state: 'visible' })
      if (!firstUse)
        await page.screenshot({
          path: screenshots + (mobile ? '/mobile-findings.png' : '/desktop-findings.png'),
          fullPage: true,
        })
      if (mobile)
        await page
          .getByRole('combobox', { name: 'More review actions', exact: true })
          .selectOption('run')
      else await page.getByRole('button', { name: 'Review again', exact: true }).click()
      await page
        .getByRole('button', { name: 'Copy draft from the earlier pass', exact: true })
        .click()
      assert.equal(
        await editor.inputValue(),
        'Please check restore before clearing the draft. @reviewer https://github.com/acme/studio/pull/184',
      )
      await page.waitForFunction(() =>
        window.requests.some(
          (r) =>
            r.path.endsWith('/save') &&
            r.input.reviewId !==
              window.requests.find((r) => r.path.endsWith('/start')).input.requestId,
        ),
      )
      await page.evaluate(() => (window.delaySave = true))
      await editor.fill(
        'Please check restore before clearing the draft. @reviewer https://github.com/acme/studio/pull/184 Latest edit.',
      )
      await page.getByRole('button', { name: 'Preview review', exact: true }).click()
      await page.getByRole('button', { name: 'Saving draft…', exact: true }).waitFor()
      await page.waitForFunction(() => typeof window.releaseSave === 'function')
      await page.evaluate(() => {
        window.delaySave = false
        window.releaseSave()
      })
      await page.getByRole('button', { name: 'Publish review', exact: true }).waitFor()
      if (!mobile) {
        const confirmation = page.getByRole('dialog')
        assert.equal(await confirmation.getAttribute('data-surface'), 'solid')
        assert.equal(
          await confirmation.evaluate((element) => getComputedStyle(element).backdropFilter),
          'none',
        )
      }
      assert.ok(await page.getByText('Mentions and references:', { exact: false }).count())
      assert.ok(await page.getByText('dominic', { exact: false }).count())
      if (!firstUse)
        await page.screenshot({
          path: screenshots + (mobile ? '/mobile-preview.png' : '/desktop-preview.png'),
          fullPage: true,
        })
      assert.equal(
        await page.evaluate(
          () => window.requests.filter((r) => r.path.endsWith('/publish')).length,
        ),
        0,
      )
      await page.evaluate(() => window.changeSavedDecision())
      await page.getByRole('dialog').getByText('The draft changed.', { exact: false }).waitFor()
      assert.equal(
        await page.getByRole('button', { name: 'Publish review', exact: true }).isDisabled(),
        true,
      )
      assert.ok((await page.getByRole('dialog').innerText()).includes('Comment'))
      await page.getByRole('button', { name: 'Back to draft', exact: true }).click()
      if (!mobile)
        await page.waitForFunction(() => document.activeElement?.textContent === 'Preview review')
      await page.getByRole('button', { name: 'Preview review', exact: true }).click()
      await page.getByRole('button', { name: 'Publish review', exact: true }).waitFor()
      assert.ok((await page.getByRole('dialog').innerText()).includes('Request changes'))
      await page.evaluate(() => (window.failPublish = true))
      await page.getByRole('button', { name: 'Publish review', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByText('Publish response unavailable.', { exact: false })
        .waitFor()
      assert.equal(
        await page.getByRole('button', { name: 'Publish review', exact: true }).isVisible(),
        true,
      )
      await page.evaluate(() => (window.delayPublish = true))
      await page.getByRole('button', { name: 'Publish review', exact: true }).click()
      const publishing = page.getByRole('button', { name: 'Publishing…', exact: true })
      await publishing.waitFor()
      assert.equal(await publishing.isDisabled(), true)
      await page.evaluate(() => window.releasePublish())
      await page.getByText('Review published.', { exact: false }).waitFor()
      await page.waitForFunction(
        () => window.requests.filter((r) => r.path.endsWith('/publish')).length === 2,
      )
      const sent = await page.evaluate(
        () => window.requests.filter((r) => r.path.endsWith('/publish')).at(-1).input,
      )
      assert.ok(sent.body.startsWith('Please check restore'))
      assert.ok(sent.body.includes('<!-- dovo-review:'))
      assert.ok(sent.body.includes('Latest edit.'))
      if (mobile) {
        await page
          .getByRole('dialog')
          .getByRole('combobox', { name: 'More review actions', exact: true })
          .selectOption('configure')
        await page
          .getByRole('combobox', { name: 'Review scope', exact: true })
          .selectOption('stack')
      } else {
        await page.getByRole('button', { name: 'Configure agent review', exact: true }).click()
        await page.getByRole('button', { name: 'Review scope', exact: true }).click()
        await page.getByRole('option', { name: 'Full stack · 2 PRs', exact: true }).click()
      }
      await page.getByRole('button', { name: 'Review again', exact: true }).click()
      await page.getByText('#183 · Stack member 183', { exact: true }).waitFor()
      assert.equal(
        (
          await page.evaluate(
            () => window.requests.filter((request) => request.path.endsWith('/start')).at(-1).input,
          )
        ).fullStack,
        true,
      )
      await page.getByRole('button', { name: 'Stop stack review', exact: true }).click()
      const stop = await page.evaluate(() =>
        window.requests.find((request) => request.input.stackId === 'stack-run'),
      )
      assert.equal(stop.path, '/api/review/pull/stop')
      await page.getByRole('button', { name: 'Open review for PR #183', exact: true }).click()
      assert.equal((await page.evaluate(() => window.stackOpened)).member.target.number, 183)
      assert.equal(
        (await page.evaluate(() => window.stackOpened)).runtimeId,
        firstUse ? 'remote' : 'runtime',
      )
      if (mobile) await page.getByRole('button', { name: 'Open agent review', exact: true }).click()
      await editor.fill(
        'Please check restore before clearing the draft. @reviewer https://github.com/acme/studio/pull/184 Latest edit.',
      )
      await page.evaluate(() => window.push())
      await page.getByText('This PR has new changes.', { exact: false }).waitFor()
      await location.click()
      await captured
        .getByText(`Captured patch at aaaaaaa · 122 · ${side}`, { exact: true })
        .waitFor()
      await captured
        .getByRole('button', { name: mobile ? 'Back to findings' : 'Close', exact: true })
        .click()
      assert.equal(
        await editor.inputValue(),
        'Please check restore before clearing the draft. @reviewer https://github.com/acme/studio/pull/184 Latest edit.',
      )
      assert.deepEqual(errors, [])
      if (mobile && !firstUse) {
        await page.goto('about:blank')
        await page.setContent('<main id="app"></main>')
        await page.evaluate(() => {
          window.rowReview = true
        })
        await page.addScriptTag({ content: built.outputFiles[0].text })
        await page.waitForFunction(
          () => window.requests.filter((request) => request.path.endsWith('/start')).length === 1,
        )
        assert.deepEqual(
          await page.evaluate(
            () => window.requests.find((request) => request.path.endsWith('/start')).input.target,
          ),
          {
            repositoryId: 'repo',
            number: 184,
            connectionId: undefined,
            expectedDestination: 'destination',
          },
        )
        await page.getByRole('button', { name: 'Add to draft', exact: true }).waitFor()
        await page.evaluate(() => window.refreshComputers())
        await page.getByRole('button', { name: 'Add to draft', exact: true }).waitFor()
        assert.equal(
          await page.evaluate(
            () => window.requests.filter((request) => request.path.endsWith('/start')).length,
          ),
          1,
        )
      }
      await page.close()
    }
  console.log(
    `PR review desktop and mobile: multiple reviewers, image input, remote host/account routing, offline report retention, draft isolation across computers, exact captured lines and return positions, evidence and finding checks, snapshot context navigation, active batch progress, first-use model setup, saved reviewer start, finding add/remove with edited-text preservation, copied drafts across passes, save on preview, exact preview, failed publish retention, in-flight guard, explicit publish, stale report and draft retention passed. Screenshots: ${screenshots}. Native controls, model and forge are mocked.`,
  )
} finally {
  await browser.close()
}
