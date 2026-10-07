import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const state = `import {useState,useRef} from 'react';export function useApplicationState(initial){const [value,set]=useState(initial);const ref=useRef(value);ref.current=value;return [value,next=>{ref.current=typeof next==='function'?next(ref.current):next;set(ref.current)},ref]}`
const mocks = {
  '@dovo/studio-core': `export * from '@dovo/protocol';export * from '@dovo/client-runtime';export const useRepositorySources=()=>window.sources;`,
  '@dovo/studio-core/state': state,
  '../../../runtime/state/application-state': state,
  '../../../runtime/connection/provider': `export const useRuntime=()=>window.runtime;`,
  '../../../shell/navigation': `export const useNavigation=()=>({focused:true});`,
  'react-native': `export const AppState={currentState:'active',addEventListener:()=>({remove(){}})};`,
}
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {Effect} from 'effect';
import {usePulls as useDesktopPulls} from '${root}/packages/extension-scm/src/pulls/list/use-pulls.ts';
import {usePulls as useMobilePulls} from '${root}/apps/mobile/src/scm/pulls/list/use-pulls.ts';
const cache={readEffect:()=>Effect.succeed(null),writeEffect:()=>Effect.void};
window.requests=[];const request=(profile,path,input)=>Effect.sync(()=>{window.requests.push({runtime:profile.id,path,input});return {pulls:[{number:7,title:'PR',url:'https://github.com/team/app/pull/7',state:'open',draft:false,author:'work',updatedAt:'2026-10-07',head:'feature',base:'main',labels:[],viewerIsAuthor:profile.id==='a-work'}],page:1,hasMore:false}});
const make=(id,account,connected=true)=>{const profile={id,name:id,connection:{address:'http://'+id+':8787',token:id+'-token'}};const repository={id:'app',name:'App',path:'/app',branch:'main',gitIdentity:'github.com/team/app',pullIdentity:'github.com/team/app',forge:{connectionId:account,repository:'team/app',revision:'1'}};return {key:JSON.stringify([id,repository.id]),runtimeId:id,runtimeName:id,profile,repository,connected,scope:JSON.stringify([id,account]),readCache:cache,requestEffect:(path,input)=>request(profile,path,input)}};
window.sources=[make('a-work','work'),make('z-personal','personal')];
window.runtime={readRuntimeEffect:request,cacheForRuntime:()=>cache,overviews:window.sources.map(source=>({profile:source.profile,connected:source.connected,snapshot:{workspace:{repositories:[source.repository]}}}))};
function Desktop(){const [target,setTarget]=useState('');window.selectTarget=setTarget;const value=useDesktopPulls('open',target);window.result=value;return <pre>{JSON.stringify(value.pages.map(page=>({runtime:page.source.runtimeId,pulls:page.pulls})))}</pre>}
function Mobile(){const [target,setTarget]=useState('');window.selectTarget=setTarget;const value=useMobilePulls(target,'open');window.result=value;return <pre>{JSON.stringify(value.pages.map(page=>({runtime:page.runtimeId,pulls:page.pulls})))}</pre>}
const rootView=createRoot(document.getElementById('app'));window.start=mode=>rootView.render(mode==='desktop'?<Desktop/>:<Mobile/>);window.disconnect=()=>{window.sources=window.sources.map(source=>({...source,connected:source.runtimeId!=='a-work'}));window.runtime={...window.runtime,overviews:window.runtime.overviews.map(entry=>({...entry,connected:entry.profile.id!=='a-work'}))};window.selectTarget('');};
`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  alias: {
    react: root + '/packages/studio-ui/node_modules/react',
    '@dovo/protocol': root + '/packages/protocol/src/index.ts',
    '@dovo/client-runtime': root + '/packages/client-runtime/src/index.ts',
  },
  nodePaths: [root + '/node_modules', root + '/packages/studio-ui/node_modules'],
  plugins: [
    {
      name: 'fixtures',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          mocks[path] ? { path, namespace: 'fixture' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'tsx',
          resolveDir: root,
        }))
      },
    },
  ],
})
const browser = await chromium.launch()
try {
  for (const mode of ['desktop', 'mobile']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.evaluate((mode) => window.start(mode), mode)
    await page.waitForFunction(() => window.result?.pages.length === 1 && !window.result.busy)
    assert.deepEqual(await page.evaluate(() => window.requests.map((request) => request.runtime)), [
      'a-work',
    ])
    assert.equal(await page.evaluate(() => window.result.pages[0].pulls[0].viewerIsAuthor), true)
    await page.evaluate(() => {
      window.requests = []
      window.selectTarget(JSON.stringify(['z-personal', 'app']))
    })
    await page.waitForFunction(() => window.requests.length && !window.result.busy)
    assert.deepEqual(await page.evaluate(() => window.requests.map((request) => request.runtime)), [
      'z-personal',
    ])
    assert.equal(await page.evaluate(() => window.result.pages[0].pulls[0].viewerIsAuthor), false)
    await page.evaluate(() => {
      window.requests = []
      window.disconnect()
    })
    await page.waitForFunction(() => window.requests.length && !window.result.busy)
    assert.deepEqual(await page.evaluate(() => window.requests.map((request) => request.runtime)), [
      'z-personal',
    ])
    assert.equal(await page.evaluate(() => window.result.pages.length), 1)
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log(
    'Desktop and mobile PR hooks query one server, preserve account flags, honor project selection and fail over.',
  )
} finally {
  await browser.close()
}
