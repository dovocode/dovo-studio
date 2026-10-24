import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const resolveDir = new URL('../apps/mobile/', import.meta.url).pathname
const controls = `
import {Effect} from 'effect';
const css=style=>Object.assign({},...(Array.isArray(style)?style:[style]).flat().filter(Boolean));
export const View=({children,style})=><div style={css(style)}>{children}</div>;
export const ScrollView=({children,contentContainerStyle,maximumZoomScale})=><div data-zoom={maximumZoomScale} style={css(contentContainerStyle)}>{children}</div>;
export const Text=({children})=><span>{children}</span>;
export const ActivityIndicator=({accessibilityLabel})=><span>{accessibilityLabel}</span>;
export const Pressable=({children,onPress,accessibilityLabel})=><button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
export const Image=({source,accessibilityLabel,onError})=><img src={source.uri} alt={accessibilityLabel} onError={onError}/>;
export const IconButton=({label,icon,variant,onPress,size=44})=><button aria-label={label} data-icon={icon} data-variant={variant} onClick={onPress} style={{width:size,height:size,borderRadius:size/2}}>×</button>;
export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;
export const SafeModal=({visible,children})=>visible?<div role="dialog" style={{position:"fixed",inset:0}}>{children}</div>:null;
export const useAction=()=>({busy:false,error:'',act:fn=>void fn()});
export const useTheme=()=>({styles:{screen:{position:'relative',width:'100%',height:'100%'}},colors:{}});
export const taskImageReadSchema={};
export const EditChatImage=()=>null;
const readEffect=(path,input)=>Effect.tryPromise({try:signal=>window.call(path,input,signal),catch:reason=>reason});
export const useRuntime=()=>({connected:true,connection:{address:'http://paired-runtime',token:'paired-token'},readEffect,callEffect:()=>{throw Error('Image reads must not refresh the workspace')}});
`
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ServerImage} from './src/ui/content/server-image';
window.originals=0;window.requests=[];window.aborted=[];window.fail=true;window.pending={};
window.call=(path,input,signal)=>{window.requests.push({path,input});if(window.fail)return Promise.reject(new Error('Temporary image failure'));if(input.path==='slow.png')return new Promise(resolve=>{window.pending.slow=resolve;signal.addEventListener('abort',()=>window.aborted.push(input.path),{once:true})});return Promise.resolve({uri:window.png})};
function App(){const [path,setPath]=useState('shot.png');window.setPath=setPath;return <ServerImage source={{taskId:'task',path}} label="Screenshot" onOpenOriginal={async()=>{window.originals++}}/>}
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  plugins: [
    {
      name: 'native-image-controls',
      setup(builder) {
        const paths = new Set([
          'react-native',
          '@dovo/protocol',
          '../../runtime/connection/provider',
          '../theme',
          './text',
          '../controls/action',
          '../controls/icon-button',
          '../controls/use-action',
          '../layout/safe-modal',
          '../../tasks/composer/chat-image-edit-context',
        ])
        builder.onResolve({ filter: /.*/ }, ({ path }) =>
          paths.has(path) ? { path, namespace: 'mock' } : undefined,
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: controls,
          loader: 'tsx',
          resolveDir,
        }))
      },
    },
  ],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.evaluate(
    () =>
      (window.png =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6K0sAAAAASUVORK5CYII='),
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.getByText('Temporary image failure').waitFor()
  await page.getByRole('button', { name: 'Open original & download' }).waitFor()
  await page.evaluate(() => (window.fail = false))
  await page.getByRole('button', { name: 'Retry Screenshot' }).click()
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1)
  assert.deepEqual(await page.evaluate(() => window.requests[0]), {
    path: '/api/tasks/images/read',
    input: { taskId: 'task', path: 'shot.png', maxSize: 1024 },
  })
  await page.getByRole('button', { name: 'Open Screenshot' }).click()
  await page.getByRole('dialog').waitFor()
  await page.waitForFunction(() =>
    window.requests.some((request) => request.input.maxSize === 2048),
  )
  await page.getByRole('button', { name: 'Open original & download' }).click()
  assert.equal(await page.evaluate(() => window.originals), 1)
  const close = page.getByRole('button', { name: 'Close image' })
  assert.equal(await close.textContent(), '×')
  assert.equal(await close.getAttribute('data-icon'), 'close')
  assert.equal(await close.getAttribute('data-variant'), 'glass')
  assert.equal(await close.evaluate((element) => element.closest('[data-zoom]') === null), true)
  const bounds = await close.boundingBox()
  assert.equal(bounds.width, 44)
  assert.equal(bounds.height, 44)
  assert.equal(bounds.x, 390 - 16 - 44)
  assert.equal(bounds.y, 12)
  // Simulate the image content moving/scaling independently of the modal chrome.
  await page.locator('[data-zoom="4"]').evaluate((element) => {
    element.style.transformOrigin = 'top left'
    element.style.transform = 'translate(-120px, -200px) scale(4)'
  })
  assert.deepEqual(await close.boundingBox(), bounds)
  await close.click()
  await page.evaluate(() => window.setPath('slow.png'))
  await page.getByText('Loading Screenshot').waitFor()
  await page.evaluate(() => window.setPath('new.png'))
  await page.waitForFunction(() => window.aborted.includes('slow.png'))
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1)
  await page.evaluate(() => window.pending.slow({ uri: 'data:image/png;base64,broken' }))
  assert.equal(await page.locator('img').getAttribute('src'), await page.evaluate(() => window.png))
  assert.deepEqual(errors, [])
  console.log(
    'Mobile server image checks passed: bounded runtime reads, visible errors, retry, decoded image, preview, cancellation, and stale-response isolation.',
  )
} finally {
  await browser.close()
}
