import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const resolveDir = new URL('../apps/mobile/', import.meta.url).pathname
const controls = `
export const View=({children})=><div>{children}</div>;
export const ScrollView=View;
export const Text=({children})=><span>{children}</span>;
export const ActivityIndicator=({accessibilityLabel})=><span>{accessibilityLabel}</span>;
export const Pressable=({children,onPress,accessibilityLabel})=><button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
export const Image=({source,accessibilityLabel,onError})=><img src={source.uri} alt={accessibilityLabel} onError={onError}/>;
export const Action=({label,onPress})=><button onClick={onPress}>{label}</button>;
export const SafeModal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;
export const useTheme=()=>({styles:{},colors:{}});
export const taskImageReadSchema={};
export const runClientEffect=value=>Promise.resolve(value);
export const useRuntime=()=>({connected:true,connection:{address:'http://paired-runtime',token:'paired-token'},callEffect:window.call});
`
const built = await build({
  stdin: {
    resolveDir,
    loader: 'tsx',
    contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {ServerImage} from './src/ui/content/server-image';
window.requests=[];window.fail=true;window.pending={};
window.call=(path,input)=>{window.requests.push({path,input});if(window.fail)return Promise.reject(new Error('Temporary image failure'));if(input.path==='slow.png')return new Promise(resolve=>window.pending.slow=resolve);return Promise.resolve({uri:window.png})};
function App(){const [path,setPath]=useState('shot.png');window.setPath=setPath;return <ServerImage source={{taskId:'task',path}} label="Screenshot"/>}
createRoot(document.getElementById('app')).render(<App/>);`,
  },
  plugins: [
    {
      name: 'native-image-controls',
      setup(builder) {
        const paths = new Set([
          'react-native',
          '@dovo/client-runtime',
          '@dovo/protocol',
          '../../runtime/connection/provider',
          '../theme',
          './text',
          '../controls/action',
          '../layout/safe-modal',
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
  await page.evaluate(() => (window.fail = false))
  await page.getByRole('button', { name: 'Retry Screenshot' }).click()
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1)
  assert.deepEqual(await page.evaluate(() => window.requests[0]), {
    path: '/api/tasks/images/read',
    input: { taskId: 'task', path: 'shot.png' },
  })
  await page.getByRole('button', { name: 'Open Screenshot' }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: 'Close image' }).click()
  await page.evaluate(() => window.setPath('slow.png'))
  await page.getByText('Loading Screenshot').waitFor()
  await page.evaluate(() => window.setPath('new.png'))
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1)
  await page.evaluate(() => window.pending.slow({ uri: 'data:image/png;base64,broken' }))
  assert.equal(await page.locator('img').getAttribute('src'), await page.evaluate(() => window.png))
  assert.deepEqual(errors, [])
  console.log(
    'Mobile server image checks passed: runtime reads, visible errors, retry, decoded image, preview, and stale-response isolation.',
  )
} finally {
  await browser.close()
}
