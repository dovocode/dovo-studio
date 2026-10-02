import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { chromium } from '../packages/runtime/node_modules/playwright/index.mjs'
const built = await build({
  stdin: {
    contents: `import {artifactPreviewHtml} from './src/conversation/artifacts.ts';window.preview=artifactPreviewHtml;`,
    resolveDir: new URL('../packages/protocol/', import.meta.url).pathname,
  },
  bundle: true,
  format: 'iife',
  write: false,
  target: 'es2022',
})
const mocks = {
  '@dovo/studio-core': `import React,{createContext,useContext} from 'react';const Context=createContext(null);export const useWorkspace=()=>useContext(Context)??window.artifactWorkspace??({request:window.artifactRequest,connected:true,activeRuntimeId:'runtime',snapshot:{artifactsEnabled:window.artifactsEnabled}});export const WorkspaceScope=({profile,children})=><Context.Provider value={{...useWorkspace(),activeRuntimeId:profile.id,snapshot:{artifactsEnabled:true},request:(path,input)=>window.artifactRequest(path,input,profile.id)}}>{children}</Context.Provider>;`,
  '@dovo/studio-ui': `import React from 'react';export const Button=({children,onClick,disabled})=><button onClick={onClick} disabled={disabled}>{children}</button>;export const Input=({className,...props})=><input {...props}/>;export const Dialog=({children})=><section>{children}</section>;export const DialogContent=Dialog;export const DialogDescription=({children})=><p>{children}</p>;export const DialogTitle=({children})=><h1>{children}</h1>;export const MessageResponse=({children})=><p>{children}</p>;`,
  '../../runtime/connection/provider': `export const useRuntime=()=>({read:window.artifactRequest,connected:true,activeId:'runtime',snapshot:{artifactsEnabled:window.artifactsEnabled}});`,
  'react-native': `import React from 'react';export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Modal=View;export const ActivityIndicator=()=> <p>Loading</p>;export const Pressable=({children,onPress,accessibilityLabel})=><button onClick={onPress} aria-label={accessibilityLabel}>{children}</button>;export const Alert={alert:()=>{}};export const StyleSheet={create:x=>x};export const Platform={OS:'ios'};`,
  'react-native-safe-area-context': `export {View as SafeAreaView} from 'react-native';`,
  'react-native-webview': `import React from 'react';export default ({source})=><iframe title="Mobile preview" sandbox="allow-scripts" srcDoc={source.html}/>;`,
  'expo-file-system': `export class File {};export const Paths={cache:''};`,
  'expo-sharing': `export const isAvailableAsync=async()=>false;export const shareAsync=async()=>{};`,
  'expo-crypto': `export const randomUUID=()=>crypto.randomUUID();`,
  './text': `import React from 'react';export const Text=({children})=><span>{children}</span>;`,
  './markdown': `import React from 'react';export const Markdown=({text})=><p>{text}</p>;`,
  '../controls/action': `import React from 'react';export const Action=({label,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{label}</button>;`,
  '../controls/icon': `export const Icon=()=>null;`,
}
const interfaces = await Promise.all(
  ['desktop', 'mobile', 'library'].map(async (platform) => {
    const contents =
      platform === 'library'
        ? `import {createRoot} from 'react-dom/client';import {useState} from 'react';import ArtifactsView from './src/artifacts-view.tsx';function App(){const[tick,setTick]=useState(0);window.updateLibrary=()=>setTick(x=>x+1);return <ArtifactsView/>}createRoot(document.getElementById('app')).render(<App/>);`
        : platform === 'desktop'
          ? `import {createRoot} from 'react-dom/client';import {ArtifactLibrary} from './src/chat/artifacts.tsx';createRoot(document.getElementById('app')).render(<ArtifactLibrary taskId="thread"/>);`
          : `import {createRoot} from 'react-dom/client';import {ArtifactCard} from './src/ui/content/artifacts.tsx';createRoot(document.getElementById('app')).render(<ArtifactCard reference={{id:'notes',taskId:'thread',title:'Notes',format:'markdown',revision:2}}/>);`
    const result = await build({
      stdin: {
        contents,
        loader: 'tsx',
        resolveDir: new URL(
          platform !== 'mobile' ? '../packages/extension-tasks/' : '../apps/mobile/',
          import.meta.url,
        ).pathname,
      },
      bundle: true,
      format: 'iife',
      write: false,
      target: 'es2022',
      jsx: 'automatic',
      plugins: [
        {
          name: 'artifact-fixtures',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) =>
              Object.hasOwn(mocks, path) ? { path, namespace: 'fixtures' } : undefined,
            )
            builder.onLoad({ filter: /.*/, namespace: 'fixtures' }, ({ path }) => ({
              contents: mocks[path],
              loader: 'tsx',
              resolveDir: new URL('../packages/studio-ui/', import.meta.url).pathname,
            }))
          },
        },
      ],
    })
    return { platform, code: result.outputFiles[0].text }
  }),
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } })
  const requests = []
  const failures = []
  page.on('requestfailed', (request) =>
    failures.push({ url: request.url(), error: request.failure()?.errorText }),
  )
  page.on('request', (request) => {
    if (/https?:/.test(request.url())) requests.push(request.url())
  })
  await page.setContent('<main>Trusted host</main>')
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const guest = `<button id="count">0</button><button id="navigate">Navigate</button><script>
let count=0;document.querySelector('#count').onclick=()=>document.querySelector('#count').textContent=++count;
document.querySelector('#navigate').onclick=()=>location.href='https://artifact-test.invalid/navigation';
try{parent.parent.document.querySelector('main').textContent='Compromised'}catch{document.body.dataset.isolated='yes'}
fetch('https://artifact-test.invalid/leak').catch(()=>document.body.dataset.networkBlocked='yes');
</script><img src="https://artifact-test.invalid/image"><iframe src="https://artifact-test.invalid/frame"></iframe>`
  await page.evaluate((content) => {
    const frame = document.createElement('iframe')
    frame.sandbox = 'allow-scripts'
    frame.srcdoc = window.preview(content)
    document.body.append(frame)
  }, guest)
  const frame = page.frameLocator('iframe').frameLocator('iframe')
  await frame.locator('#count').click()
  assert.equal(await frame.locator('#count').textContent(), '1')
  assert.equal(await page.locator('main').textContent(), 'Trusted host')
  assert.equal(await frame.locator('body').getAttribute('data-isolated'), 'yes')
  await frame.locator('body[data-network-blocked="yes"]').waitFor()
  const navigationBlocked = page.waitForEvent('console', {
    timeout: 5000,
    predicate: (message) =>
      message.text().includes('artifact-test.invalid') &&
      message.text().includes('frame-src about:'),
  })
  await frame.locator('#navigate').click()
  await navigationBlocked
  assert.ok(
    requests.every((url) =>
      failures.some((failure) => failure.url === url && /csp/i.test(failure.error ?? '')),
    ),
    JSON.stringify({ requests, failures }),
  )
  // Exercise the iOS shape: trusted WebView document directly hosts an opaque guest.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 700 } })
  const html = await page.evaluate(() =>
    window.preview(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="blue"/></svg>',
    ),
  )
  await mobile.setContent(html)
  await mobile.frameLocator('iframe').locator('circle').waitFor()
  assert.equal(await mobile.frameLocator('iframe').locator('circle').getAttribute('fill'), 'blue')
  for (const ui of interfaces.filter((ui) => ui.platform !== 'library')) {
    const view = await browser.newPage()
    await view.setContent('<div id="app"></div>')
    await view.evaluate(() => {
      window.artifactsEnabled = true
      window.artifactCalls = []
      const notes = {
        id: 'notes',
        taskId: 'thread',
        title: 'Notes',
        format: 'markdown',
        revision: 2,
        createdAt: '2026-10-03T00:00:00Z',
        updatedAt: '2026-10-03T00:00:00Z',
      }
      const interactive = {
        ...notes,
        id: 'interactive',
        title: 'Counter',
        format: 'html',
        revision: 1,
      }
      window.artifactRequest = async (path, input) => {
        window.artifactCalls.push({ path, input })
        if (path.endsWith('/list')) return { artifacts: [notes, interactive] }
        const metadata = input.id === 'notes' ? notes : interactive
        if (path.endsWith('/versions'))
          return {
            versions: metadata.id === 'notes' ? [notes, { ...notes, revision: 1 }] : [interactive],
          }
        return {
          artifact: {
            ...metadata,
            revision: input.revision ?? metadata.revision,
            content:
              metadata.id === 'notes'
                ? input.revision === 1
                  ? 'Earlier notes'
                  : 'Current notes'
                : '<button id="interactive">Interactive artifact</button>',
          },
        }
      }
    })
    await view.addScriptTag({ content: ui.code })
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Artifacts' : 'Open artifact Notes',
        exact: true,
      })
      .waitFor()
    assert.equal(
      await view.evaluate(() => window.artifactCalls.length),
      0,
      'Closed cards must not fetch artifact bodies',
    )
    await view
      .getByRole('button', {
        name: ui.platform === 'desktop' ? 'Artifacts' : 'Open artifact Notes',
        exact: true,
      })
      .click()
    await view.getByText('Current notes', { exact: true }).waitFor()
    if (ui.platform === 'desktop') await view.getByLabel('Artifact version').selectOption('1')
    else {
      await view.getByRole('button', { name: 'Latest version', exact: true }).click()
      await view.getByText('Version 1', { exact: true }).click()
    }
    await view.getByText('Earlier notes', { exact: true }).waitFor()
    if (ui.platform === 'desktop')
      await view.getByLabel('Artifact', { exact: true }).selectOption('interactive')
    else {
      await view.getByRole('button', { name: 'Artifacts', exact: true }).click()
      await view.getByText('Counter', { exact: true }).click()
    }
    await view.frameLocator('iframe').frameLocator('iframe').locator('#interactive').waitFor()
    await view.getByRole('button', { name: 'Source', exact: true }).click()
    await view
      .getByText('<button id="interactive">Interactive artifact</button>', { exact: true })
      .waitFor()
    await view.close()
    const disabled = await browser.newPage()
    await disabled.setContent('<div id="app"></div>')
    await disabled.evaluate(() => {
      window.artifactsEnabled = false
      window.artifactRequest = () => {
        throw new Error('Disabled artifact UI must not request data')
      }
    })
    await disabled.addScriptTag({ content: ui.code })
    assert.equal(await disabled.getByRole('button').count(), 0)
    await disabled.close()
  }
  const library = await browser.newPage()
  await library.setContent('<div id="app"></div>')
  await library.evaluate(() => {
    const metadata = {
      id: 'shared',
      taskId: 'thread',
      title: 'Shared artifact',
      format: 'markdown',
      revision: 1,
      createdAt: '2026-10-03T00:00:00Z',
      updatedAt: '2026-10-03T00:00:00Z',
      threadTitle: 'Research',
      threadState: 'settled',
    }
    const profiles = ['Host A', 'Host B', 'Offline host'].map((name, index) => ({
      id: String(index),
      name,
      connection: { address: 'http://host' + index, token: 'test' },
    }))
    window.libraryCalls = []
    window.previewHosts = []
    window.artifactWorkspace = {
      connected: true,
      snapshot: { artifactsEnabled: true },
      runtimes: profiles.map((profile, index) => ({
        profile,
        connected: index !== 2,
        snapshot: { artifactsEnabled: true },
      })),
      readRuntime: async (profile) => {
        window.libraryCalls.push(profile.id)
        return { artifacts: [{ ...metadata, id: 'shared-' + profile.id }] }
      },
    }
    window.artifactRequest = async (path, input, host) => {
      window.previewHosts.push(host)
      const artifact = { ...metadata, id: input.id, content: 'Content from Host ' + host }
      return path.endsWith('/versions')
        ? { versions: [artifact] }
        : path.endsWith('/list')
          ? { artifacts: [artifact] }
          : { artifact }
    }
  })
  await library.addScriptTag({ content: interfaces.find((ui) => ui.platform === 'library').code })
  await library.getByText('Host A · Research · settled', { exact: true }).waitFor()
  await library.getByText('Host B · Research · settled', { exact: true }).waitFor()
  assert.match(await library.getByRole('alert').textContent(), /Offline host/)
  assert.deepEqual(await library.evaluate(() => window.libraryCalls), ['0', '1'])
  assert.deepEqual(await library.evaluate(() => window.previewHosts), [])
  await library.evaluate(() => window.updateLibrary())
  await library.getByLabel('Search artifacts').fill('Host B')
  assert.equal(await library.getByRole('button', { name: /Shared artifact/ }).count(), 1)
  await library.getByRole('button', { name: /Shared artifact/ }).click()
  await library.getByText('Content from Host 1', { exact: true }).waitFor()
  assert.ok((await library.evaluate(() => window.previewHosts)).every((host) => host === '1'))
  assert.deepEqual(
    await library.evaluate(() => window.libraryCalls),
    ['0', '1'],
    'Run snapshot rerenders must not reload the global library',
  )
  await library.close()
  console.log(
    'Artifact preview: interactive HTML, SVG, desktop/mobile isolation, blocked external requests, lazy loading, version selection and source views passed.',
  )
} finally {
  await browser.close()
}
