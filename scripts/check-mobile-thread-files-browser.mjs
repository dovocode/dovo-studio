import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const sharp = createRequire(new URL('../packages/runtime/package.json', import.meta.url))('sharp')
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chromium, bundleBrowser } from './browser/harness.mjs'
import { startRuntime } from '../packages/runtime/dist/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/src/'
const stubs = [
  {
    path: 'react-native',
    contents: `export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Image=({source,accessibilityLabel})=><img alt={accessibilityLabel} src={source.uri}/>;export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>;export const SectionList=({sections,renderItem})=><div>{sections.flatMap(section=>section.data.map(item=><div key={item.node.path}>{renderItem({item})}</div>))}</div>;export const Alert={alert:(_title,_body,actions)=>window.confirmDiscard=()=>actions.find(action=>action.text==='Discard').onPress()};`,
  },
  {
    path: '../../runtime/connection/provider',
    importer: mobile,
    contents: `export const useRuntime=()=>window.runtime;`,
  },
  {
    path: '../../ui/theme',
    importer: mobile,
    contents: `export const useTheme=()=>({colors:{},styles:{}});`,
  },
  {
    path: '../theme',
    importer: mobile + 'ui/content',
    contents: `export const useTheme=()=>({colors:{},styles:{}});`,
  },
  {
    path: '../controls/icon',
    importer: mobile + 'ui/content',
    contents: `export const Icon=()=>null;`,
  },
  {
    path: '../../ui/content/text',
    importer: mobile,
    contents: `export const Text=({children,accessibilityRole})=><span role={accessibilityRole}>{children}</span>;`,
  },
  {
    path: './text',
    importer: mobile + 'ui/content',
    contents: `export const Text=({children})=><span>{children}</span>;`,
  },
  {
    path: '../../ui/content/code-block',
    importer: mobile,
    contents: `export const CodeBlock=({content})=><pre>{content}</pre>;`,
  },
  {
    path: '../../ui/content/syntax-highlighter',
    importer: mobile,
    contents: `export const fileLanguage=()=> 'text';`,
  },
  {
    path: '../../ui/controls/action',
    importer: mobile,
    contents: `export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
  },
  {
    path: '../../ui/controls/choice',
    importer: mobile,
    contents: `export const Choice=({label,value,onChange,items,disabled})=><select aria-label={label} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)}>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>;`,
  },
  {
    path: '../../ui/controls/field',
    importer: mobile,
    contents: `export const SearchField=({label,value,onChangeText})=><input aria-label={label} value={value} onChange={event=>onChangeText(event.target.value)}/>;export const Field=({label,value,onChangeText,editable})=><textarea aria-label={label} value={value} disabled={!editable} onChange={event=>onChangeText(event.target.value)}/>;`,
  },
]
const built = await bundleBrowser(
  {
    stdin: {
      contents: `import {useState} from 'react';import {createRoot} from 'react-dom/client';import {decode} from '@dovo/protocol';import {TaskFiles} from '${mobile}tasks/files/task-files';window.runtime={...window.runtime,call:async(path,input,schema)=>{const response=await fetch(window.runtime.connection.address+path,{method:'POST',headers:{Authorization:'Bearer '+window.runtime.connection.token,'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await response.json();if(!response.ok)throw new Error(result.error??JSON.stringify(result));return decode(schema,result)}};function App(){const[draft,setDraft]=useState(null),[open,setOpen]=useState(true);window.toggleFiles=()=>setOpen(value=>!value);return open&&<TaskFiles task={window.task} draft={draft} onDraftChange={setDraft}/>};createRoot(document.getElementById('app')).render(<App/>);`,
      loader: 'tsx',
      resolveDir: root + 'packages/studio-ui',
    },
    nodePaths: [root + 'packages/studio-ui/node_modules'],
    alias: {
      react: root + 'packages/studio-ui/node_modules/react',
      'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
  },
  stubs,
)
const directory = await mkdtemp(join(tmpdir(), 'dovo-thread-files-'))
const linked = await mkdtemp(join(tmpdir(), 'dovo-thread-linked-'))
const token = 'mobile-thread-files-owner-at-least-32-characters'
const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
const ui = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<div id="app"></div>')
})
ui.listen(0, '127.0.0.1')
await once(ui, 'listening')
const browser = await chromium.launch({ headless: true })
try {
  await mkdir(join(directory, 'src'))
  await writeFile(join(directory, 'src', 'hello.ts'), 'export const hello = 1\n')
  await writeFile(join(directory, 'empty.txt'), '')
  await writeFile(join(linked, 'linked.txt'), 'linked contents\n')
  await writeFile(
    join(directory, 'pixel.png'),
    await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .png()
      .toBuffer(),
  )
  const s = runtime.services
  s.store.update((workspace) => ({
    ...workspace,
    repositories: [
      ...workspace.repositories,
      { id: 'folder', name: 'Thread project', path: directory, kind: 'folder', branch: '' },
      { id: 'linked', name: 'Linked project', path: linked, kind: 'folder', branch: '' },
    ],
  }))
  const task = s.tasks.create({
    title: 'Files',
    repositoryId: 'folder',
    agentId: '',
    objective: '',
  })
  s.store.updateTask(task.id, (task) => ({
    ...task,
    linkedCheckouts: [
      { id: 'link', repositoryId: 'linked', execution: 'main', access: 'read-only' },
    ],
  }))
  const address = ui.address()
  assert.ok(address && typeof address !== 'string')
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.evaluate(
    ({ task, port, token }) => {
      window.task = task
      window.runtime = {
        connected: true,
        snapshot: { workspace: { repositories: [] } },
        connection: { address: `http://127.0.0.1:${port}`, token },
      }
    },
    { task: s.store.task(task.id), port: runtime.port, token },
  )
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page
    .getByRole('button', { name: 'src/hello.ts', exact: true })
    .click({ timeout: 5000 })
    .catch(async (error) => {
      console.error(errors, await page.locator('body').innerText())
      throw error
    })
  await page.getByText('export const hello = 1', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Edit file', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'File contents', exact: true })
    .fill('export const hello = 2\n')
  await page.evaluate(() => window.toggleFiles())
  await page.getByRole('textbox', { name: 'File contents' }).waitFor({ state: 'hidden' })
  await page.evaluate(() => window.toggleFiles())
  assert.equal(
    await page.getByRole('textbox', { name: 'File contents' }).inputValue(),
    'export const hello = 2\n',
  )
  await writeFile(join(directory, 'src', 'hello.ts'), 'external change\n')
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'File changed on disk' }).waitFor()
  assert.equal(await readFile(join(directory, 'src', 'hello.ts'), 'utf8'), 'external change\n')
  await page.getByRole('button', { name: 'Refresh files' }).click()
  await page.evaluate(() => window.confirmDiscard())
  await page.getByText('external change', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Edit file', exact: true }).click()
  await page.getByRole('textbox', { name: 'File contents' }).fill('saved from mobile\n')
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  await page.getByText('saved from mobile', { exact: true }).waitFor()
  assert.equal(await readFile(join(directory, 'src', 'hello.ts'), 'utf8'), 'saved from mobile\n')
  await page.getByRole('button', { name: 'Browse files' }).click()
  await page.getByRole('textbox', { name: 'Search files' }).fill('pixel')
  await page.getByRole('button', { name: 'src/hello.ts', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'pixel.png', exact: true }).click()
  await page.getByRole('img', { name: 'pixel.png' }).waitFor()
  await page.getByRole('combobox', { name: 'Project folder' }).selectOption('link')
  await page.getByRole('button', { name: 'linked.txt', exact: true }).click()
  await page.getByText('linked contents', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Edit file' }).isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(
    'Mobile thread files: folder tree/search, preview/image, saved edits, conflict protection, draft restoration and read-only linked projects passed.',
  )
} finally {
  await browser.close()
  await runtime.close()
  await new Promise((resolve) => ui.close(resolve))
  await rm(directory, { recursive: true, force: true })
  await rm(linked, { recursive: true, force: true })
}
