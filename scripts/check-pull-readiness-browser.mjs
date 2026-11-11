import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const native = `
import {useLayoutEffect,useRef} from 'react';
const flat=style=>Object.assign({},...(Array.isArray(style)?style.flat(Infinity):[style]));
const css=style=>{const value=flat(style);if(typeof value.lineHeight==='number')value.lineHeight+='px';return value};
export const StyleSheet={create:style=>style,hairlineWidth:0.5,flatten:flat};
export const View=({children,style,accessibilityLabel,testID,onLayout})=>{const ref=useRef(null);useLayoutEffect(()=>{if(!onLayout)return;const resize=new ResizeObserver(()=>onLayout({nativeEvent:{layout:{width:ref.current.clientWidth}}}));resize.observe(ref.current);return()=>resize.disconnect()},[onLayout]);return <div ref={ref} aria-label={accessibilityLabel} data-testid={testID} style={{display:'flex',flexDirection:'column',minWidth:0,borderStyle:'solid',borderWidth:0,boxSizing:'border-box',...css(style)}}>{children}</div>};
export const Pressable=({children,onPress,accessibilityLabel,accessibilityHint,style})=><button aria-label={accessibilityLabel} aria-description={accessibilityHint} onClick={onPress} style={{display:'flex',flexDirection:'column',textAlign:'left',font:'inherit',color:'inherit',background:'transparent',borderStyle:'solid',borderWidth:0,boxSizing:'border-box',...css(typeof style==='function'?style({pressed:false}):style)}}>{children}</button>;
export const Text=({children,style,accessibilityRole})=><span role={accessibilityRole==='header'?'heading':undefined} style={{display:'block',overflowWrap:'anywhere',...css(style)}}>{children}</span>;
`
const built = await build({
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `import {createRoot} from 'react-dom/client';import {useState} from 'react';import {flushSync} from 'react-dom';
import {pullReadiness} from '@dovo/protocol';
import {PullReadinessPanel as Desktop} from './packages/extension-scm/src/pulls/detail/readiness.tsx';
import {PullReadinessPanel as Mobile} from './apps/mobile/src/scm/pulls/detail/readiness.tsx';
window.opens=[];window.mobile=false;window.scenario='mixed';
const comment=(id,fields)=>({id,kind:'inline',author:'reviewer',body:'Feedback',date:'2026-11-11',url:'https://github.com/team/repo/pull/7#'+id,...fields});
function App(){const[revision,setRevision]=useState(0);window.render=()=>flushSync(()=>setRevision(value=>value+1));
const detail={pull:{number:7,title:'Improve the review workflow',url:'https://github.com/team/repo/pull/7',repositoryUrl:'https://github.com/team/repo',state:'open',draft:false,author:'dominic',updatedAt:'2026-11-11',head:'feature',base:'main',labels:[],headSha:'a'.repeat(40),baseSha:'b'.repeat(40),body:'',additions:4,deletions:0,changedFiles:1,mergeable:true,mergeStateStatus:'CLEAN',checksState:'PENDING',reviewDecision:'REVIEW_REQUIRED',reviewers:['sam'],assignees:[],autoMergeEnabled:true},comments:[comment('root',{threadId:'one',resolved:true}),comment('reply',{threadId:'one',replyTo:'root'}),comment('two',{resolved:false}),comment('review',{kind:'review',state:'APPROVED'})],checks:['SUCCESS','SUCCESS','SKIPPED','IN_PROGRESS'].map((status,index)=>({name:'Check '+index,status})),files:[],warnings:[]};
const ready={ready:true,readConnected:true};let resources={status:ready,checks:ready,discussion:ready};
if(window.scenario==='empty'){detail.checks=[];detail.comments=[];detail.pull.checksState=null;detail.pull.reviewDecision=null;detail.pull.reviewers=[];delete detail.pull.mergeStateStatus;detail.pull.mergeable=null;}
if(window.scenario==='pending'){resources={status:{ready:false},checks:{ready:false},discussion:{ready:false}};}
if(window.scenario==='failed'){detail.pull.checksState='FAILURE';detail.checks[0].status='FAILURE';}
if(window.scenario==='behind'){detail.pull.mergeStateStatus='BEHIND';detail.pull.checksState='SUCCESS';detail.pull.reviewDecision='APPROVED';}
if(window.scenario==='offline'){const saved={...ready,readConnected:false};resources={status:saved,checks:saved,discussion:saved};}
if(window.scenario==='success'){detail.pull.checksState='SUCCESS';detail.pull.reviewDecision='APPROVED';detail.pull.reviewers=[];detail.checks=detail.checks.filter(check=>check.status==='SUCCESS');detail.comments=detail.comments.filter(comment=>comment.id!=='two');}
if(window.scenario==='unavailable'){const failed={...ready,error:'Temporary error'};resources={status:failed,checks:failed,discussion:failed};}
const summary=pullReadiness(detail,resources);window.summary=summary;const Panel=window.mobile?Mobile:Desktop;return <Panel summary={summary} onOpen={section=>window.opens.push(section)}><button className="rounded-md border bg-muted px-3 py-1.5 text-xs font-medium">Review</button><button className="rounded-md border bg-muted px-3 py-1.5 text-xs font-medium">Disable auto-merge</button></Panel>};
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    '@dovo/protocol': root + 'packages/protocol/src/index.ts',
  },
  nodePaths: [root + 'apps/mobile/node_modules', root + 'packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'native-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          if (path === 'react-native') return { path: 'native', namespace: 'fixture' }
          if (path === '../../../ui/content/text' && importer.startsWith(mobile))
            return { path: 'text', namespace: 'fixture' }
          if (path === '../../../ui/controls/icon' && importer.startsWith(mobile))
            return { path: 'icon', namespace: 'fixture' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          loader: 'tsx',
          resolveDir: root,
          contents:
            path === 'icon'
              ? `import {Check,X,History,GitPullRequest,ChevronRight} from 'lucide-react';export const Icon=({name,size,color})=>{const Icon={check:Check,close:X,history:History,pulls:GitPullRequest,next:ChevronRight}[name];return Icon?<Icon size={size} color={color}/>:null};`
              : native,
        }))
      },
    },
  ],
})
const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await server.close()
}
const output = root + 'work/pr-readiness/'
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
try {
  for (const native of [false, true]) {
    for (const width of native ? [320, 390] : [352, 900]) {
      const page = await browser.newPage({
        viewport: { width, height: 850 },
        reducedMotion: 'reduce',
      })
      page.setDefaultTimeout(5000)
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setContent(
        '<html><body class="studio dark" style="margin:0;font-family:system-ui"><main id="app" style="padding:16px"></main></body></html>',
      )
      await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: built.outputFiles[0].text })
      await page.getByRole('heading', { name: 'Waiting for CI', exact: true }).waitFor()
      await page.evaluate((isNative) => {
        window.mobile = isNative
        window.render()
      }, native)
      const panel = page.getByLabel('Pull request status', { exact: true })
      if (native)
        await page.waitForFunction(
          (expected) =>
            getComputedStyle(document.querySelector('[data-testid="PR status summaries"]'))
              .flexDirection === expected,
          width === 320 ? 'column' : 'row',
        )
      for (const section of ['checks', 'comments', 'approvals'])
        await panel
          .getByRole('button', { name: 'View pull request ' + section, exact: true })
          .click()
      assert.deepEqual(await page.evaluate(() => window.opens), ['checks', 'comments', 'approvals'])
      for (const scenario of [
        'mixed',
        'empty',
        'pending',
        'failed',
        'behind',
        'offline',
        'success',
        'unavailable',
      ]) {
        await page.evaluate((value) => {
          window.scenario = value
          window.render()
        }, scenario)
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${scenario} fits ${width}px`,
        )
        for (const button of await panel.getByRole('button').all()) {
          const bounds = await button.boundingBox()
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `Action fits ${width}px`)
        }
        if (scenario === 'pending' || scenario === 'empty' || scenario === 'unavailable')
          assert.equal(
            await page.evaluate(() =>
              window.summary.metrics.every((metric) => metric.segments.length === 0),
            ),
            true,
          )
        if (scenario === 'offline')
          await panel.getByRole('heading', { name: 'Saved merge status', exact: true }).waitFor()
        if (scenario === 'success')
          await panel.getByRole('heading', { name: 'Ready to merge', exact: true }).waitFor()
        if (['mixed', 'success', 'pending'].includes(scenario))
          await panel.screenshot({
            path: output + `${native ? 'mobile' : 'desktop'}-${width}-${scenario}.png`,
          })
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  }
  console.log(
    'PR readiness: desktop and mobile summaries, loaded/missing/failed/saved data, actions and narrow layouts passed. Screenshots: ' +
      output,
  )
} finally {
  await browser.close()
}
