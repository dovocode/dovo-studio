import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mocks = {
  expo: `import React from 'react';
    export const requireOptionalNativeModule=()=>({});
    export const requireNativeView=()=>props=>{
      window.gallery=props;
      return <div><span>{props.selectedID}</span>{props.images.map(image=><div key={image.id}>
        <button onClick={()=>props.onSelect({nativeEvent:{id:image.id}})}>Select {image.id}</button>
        <button onClick={()=>props.onRetry({nativeEvent:{id:image.id}})}>Retry {image.id}</button>
      </div>)}</div>;
    };`,
  'expo-file-system': `export const Paths={cache:'cache'};
    export class Directory {
      constructor(...parts){this.uri=parts.map(part=>part.uri??part).join('/')}
      create(){if(window.failCache)throw Error('Cache unavailable')}
      list(){return []}
    }
    export class File {
      constructor(...parts){this.uri=parts.map(part=>part.uri??part).join('/')}
      write(data){window.saved.push({uri:this.uri,data})}
    }`,
  'react-native': `export const Platform={OS:'ios'};`,
  '@dovo/protocol': `let next=0;export const randomUUID=()=>String(++next);export const attachmentReadSchema={};export const isImageAttachment=file=>file.mime==='image/png';`,
  '@dovo/client-runtime': `export const runClientEffect=effect=>effect;`,
  '@dovo/studio-core/interface-language': `export const useInterfaceText=()=>text=>text;`,
  '../../../runtime/connection/provider': `export const useRuntime=()=>({callEffect:window.readImage});`,
}
const bundle = await build({
  stdin: {
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {NativeImageGallery} from '${root}apps/mobile/src/tasks/conversation/components/native-image-gallery.native.tsx';
      window.saved=[];window.reads=[];window.failCache=false;
      const files=Array.from({length:5},(_,i)=>({id:String(i+1),name:'image-'+(i+1)+'.png',mime:'image/png',size:3}));
      window.readImage=async(path,input)=>{
        window.reads.push(input);if(window.hold)await new Promise(resolve=>window.release=resolve);
        return {attachment:files.find(file=>file.id===input.id),data:'image bytes'};
      };
      function App(){const[visible,show]=useState(true);const[key,setKey]=useState(0);window.show=show;window.restart=()=>setKey(key=>key+1);
        return visible&&<NativeImageGallery key={key} taskId="task" files={files} initial={{attachment:files[1],data:'initial bytes'}} onClose={()=>show(false)}/>;
      }createRoot(document.getElementById('app')).render(<App/>);`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  alias: {
    react: root + 'packages/studio-ui/node_modules/react',
    'react-dom/client': root + 'packages/studio-ui/node_modules/react-dom/client.js',
  },
  plugins: [
    {
      name: 'gallery-boundaries',
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
        )
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
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
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction(() => window.gallery.images.filter((image) => image.uri).length === 3)
  assert.deepEqual(await page.evaluate(() => window.reads.map((read) => read.id).sort()), [
    '1',
    '3',
  ])
  assert.equal(await page.evaluate(() => window.gallery.selectedID), '2')
  const uri = await page.evaluate(() => window.gallery.images.find((image) => image.id === '2').uri)
  // Native decoding can fail after a successful download. Retry must fetch again and
  // publish a different URI, so the native decoder cannot reuse its failed identity.
  await page.getByRole('button', { name: 'Retry 2', exact: true }).click()
  await page.waitForFunction(
    (previous) =>
      window.gallery.images.find((image) => image.id === '2').uri &&
      window.gallery.images.find((image) => image.id === '2').uri !== previous,
    uri,
  )
  assert.equal(await page.evaluate(() => window.reads.filter((read) => read.id === '2').length), 1)
  await page.getByRole('button', { name: 'Select 5', exact: true }).click()
  await page.waitForFunction(() => window.gallery.images.find((image) => image.id === '5').uri)
  assert.deepEqual(await page.evaluate(() => window.reads.slice(-2).map((read) => read.id)), [
    '4',
    '5',
  ])
  await page.evaluate(() => {
    window.hold = true
  })
  await page.getByRole('button', { name: 'Retry 5', exact: true }).click()
  await page.waitForFunction(() => !!window.release)
  const writes = await page.evaluate(() => window.saved.length)
  await page.evaluate(() => window.show(false))
  await page.waitForFunction(() => document.getElementById('app').textContent === '')
  await page.evaluate(async () => {
    window.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  assert.equal(await page.evaluate(() => window.saved.length), writes)
  await page.evaluate(() => {
    window.hold = false
    window.failCache = true
    window.show(true)
  })
  await page.waitForFunction(() =>
    window.gallery.images.every((image) => image.error?.includes('Cache unavailable')),
  )
  await page.evaluate(() => {
    window.failCache = false
  })
  await page.getByRole('button', { name: 'Retry 2', exact: true }).click()
  await page.waitForFunction(() => window.gallery.images.filter((image) => image.uri).length === 3)
  assert.deepEqual(errors, [])
  console.log(
    'Gallery orchestration passed: adjacent loading, initial bytes, decode retry, new cache identity, unmount guard and cache setup recovery. Native controls are mocked in this check.',
  )
} finally {
  await browser.close()
}
