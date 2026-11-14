import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const ui = `${root}packages/studio-ui/src`
const built = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {decode,taskSchema,defaultTaskHarness,runtimeDefaultsSchema} from '@dovo/protocol';
import {TaskMessageResponse} from './packages/extension-tasks/src/chat/thread/task-message-response';
import {UserMessageText} from './apps/mobile/src/tasks/conversation/components/user-message-text';
const resources={skills:[{name:'review',enabled:true,description:'Review',content:'Review'}],mcpServers:[{name:'docs',enabled:true,transport:'stdio',command:'docs',args:[],env:{},headerEnv:{},url:'',bearerTokenEnv:''}]};
window.task=decode(taskSchema,{id:'thread',repositoryId:'project',agentId:'',status:'draft',title:'Thread',createdAt:'2026-11-12T00:00:00Z',messages:[],files:[],draft:'',example:false});
const workspace={tasks:[window.task],repositories:[{id:'project',name:'Project',path:'/repo',branch:'main'}],agents:[]};
const defaults=decode(runtimeDefaultsSchema,{scopedSettings:{environment:{resources,agents:[{...defaultTaskHarness('claude'),id:'custom',name:'Custom'}]},shared:[]}});
window.runtime={workspace,snapshot:{workspace,defaults},connected:false,connection:null};
window.opened=[];window.source='';
function App(){const [text,setText]=useState('');window.show=value=>{window.source=value;setText(value)};return <><section id="desktop"><TaskMessageResponse taskId="thread" userMessage preserveLineBreaks>{text}</TaskMessageResponse></section><section id="assistant"><TaskMessageResponse taskId="thread">{text}</TaskMessageResponse></section><section id="mobile"><UserMessageText text={text} onLink={url=>window.opened.push(url)}/></section></>};
createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    conditions: ['development'],
    nodePaths: [`${root}packages/studio-ui/node_modules`],
    alias: {
      '@dovo/protocol': `${root}packages/protocol/src/index.ts`,
      react: `${root}packages/studio-ui/node_modules/react`,
      'react-dom': `${root}packages/studio-ui/node_modules/react-dom`,
    },
  },
  [
    {
      path: '@dovo/studio-ui',
      contents: `export {cn} from '${ui}/lib/utils';export {IconButton} from '${ui}/components/icon-button';export {MessageResponse} from '${ui}/components/ai-elements/message';export {FileTypeIcon} from '${ui}/file-tree';export {Button} from '${ui}/components/ui/button';export * as DropdownMenu from '@radix-ui/react-dropdown-menu';export {RepositoryOpenItems} from '${ui}/repository-open-items';export {Dialog,DialogContent,DialogTitle} from '${ui}/components/ui/dialog';`,
    },
    {
      path: '@dovo/studio-core',
      contents: `export {studioSyntaxTheme} from '${root}packages/studio-core/src/themes';export const useAppPreferences=()=>({themePalette:'dovo',codeTheme:'app',importedCodeThemes:[]});export const useResolvedTheme=()=> 'dark';export const useWorkspace=()=>window.runtime;export const useWorkspaceSelector=select=>select(window.runtime);export const sameWorkspaceFields=(a,b)=>Object.keys(b).every(key=>Object.is(a[key],b[key]));export const useStudioHost=()=>({});`,
    },
    {
      path: '../../../runtime/connection/provider',
      importer: `${root}apps/mobile/src/tasks/conversation/components`,
      contents: `export const useRuntimeSelector=select=>select(window.runtime);export const sameRuntimeFields=(a,b)=>Object.keys(b).every(key=>Object.is(a[key],b[key]));`,
    },
    {
      path: '../state/provider',
      importer: `${root}apps/mobile/src/tasks/conversation/components`,
      contents: `export const useConversationSelector=select=>select({task:window.task});`,
    },
    {
      path: '../../composer/native-composer-input',
      importer: `${root}apps/mobile/src/tasks/conversation/components`,
      contents: `export let nativeReferenceMessagesAvailable=false;window.enableNativeMessages=()=>{nativeReferenceMessagesAvailable=true};export const NativeReferenceMessage=props=>{window.messageNativeProps=props;return <span data-native-message>{props.text}</span>};`,
    },
    {
      path: '../../../ui/theme',
      importer: `${root}apps/mobile/src/tasks/conversation/components`,
      contents: `export const useTheme=()=>({colors:{surface:'#e5e7eb',text:'#111827',accent:'#2563eb'},styles:{chatText:{fontSize:16,lineHeight:'26px',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}});`,
    },
    {
      path: '../../../ui/content/text',
      importer: `${root}apps/mobile/src/tasks/conversation/components`,
      contents: `export {Text} from 'react-native';`,
    },
    {
      path: 'react-native',
      contents: `export const Keyboard={dismiss:()=>{}};export const Text=({children,style,accessibilityLabel,accessibilityRole,onPress,onLongPress})=>onPress?<a href="#" role={accessibilityRole} style={style} onClick={e=>{e.preventDefault();onPress()}} onContextMenu={e=>{e.preventDefault();onLongPress?.()}}>{children}</a>:<span aria-label={accessibilityLabel} style={style}>{children}</span>;export const Image=({source,style})=><img alt="" aria-hidden="true" src={source.uri} style={style}/>;`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(8000)
  const errors = []
  const referenceRequests = []
  page.on('request', (request) => {
    if (request.url().includes('dovo-reference.invalid')) referenceRequests.push(request.url())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<style>:root{--border:#9ca3af;--muted:#e5e7eb;--foreground:#111827}body{font-family:system-ui}section{margin:12px;padding:12px;overflow-wrap:anywhere}</style><div id="app"></div>',
  )
  await page.addStyleTag({
    content: (await readFile(`${root}packages/extension-tasks/src/styles.css`, 'utf8')).replace(
      /^@import.*$/gm,
      '',
    ),
  })
  await page.addScriptTag({ content: built.outputFiles[0].text })
  const show = async (text) => {
    await page.evaluate((text) => window.show(text), text)
    await page.waitForFunction((text) => window.source === text, text)
  }
  const source =
    'Read @src/__tests__/file.ts with $review and @docs using `model:agent%3Acustom/claude-fable-5-2` then @src/end.ts'
  await show(source)
  const desktop = page.locator('#desktop')
  await desktop.locator('.dovo-composer-reference').nth(4).waitFor()
  assert.deepEqual(await desktop.locator('.dovo-composer-reference').allTextContents(), [
    'file.ts',
    'review',
    'docs',
    'claude-fable-5-2',
    'end.ts',
  ])
  assert.equal(await desktop.locator('[data-harness="claude"]').count(), 1)
  assert.equal(await page.locator('#assistant .dovo-composer-reference').count(), 0)
  for (const id of ['desktop', 'mobile']) {
    if (id === 'desktop') {
      assert.equal(await page.locator(`#${id} [aria-label^="file: @src/"]`).count(), 2)
      assert.equal(await page.locator(`#${id} [aria-label^="model:"]`).count(), 1)
    } else assert.equal(await page.locator('#mobile').textContent(), source)
    assert.equal(
      await page.locator(`#${id}`).evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    )
  }
  assert.equal(await page.evaluate(() => window.source), source)
  await desktop.screenshot({ path: '/tmp/dovo-user-message-chips.png' })
  await show(
    'Literal `@src/code.ts` and [@src/link.ts](https://example.com).\n\n```txt\n@src/fenced.ts\n```\n\nperson@example.com $unknown',
  )
  await page.waitForFunction(() => !document.querySelector('#desktop .dovo-composer-reference'))
  assert.equal(await page.locator('#mobile [aria-label]').count(), 0)
  assert.equal(
    await desktop.getByRole('link', { name: '@src/link.ts' }).getAttribute('href'),
    'https://example.com/',
  )
  await show(
    'Use `model:harness%3Acodex/gpt` and `model:agent%3Amissing/fallback`\n\nhttps://github.com/team/repo/pull/42/files#note. Keep  two spaces & <tags>.',
  )
  await desktop.locator('[data-harness="codex"]').waitFor()
  assert.equal(await desktop.locator('[data-reference-icon="model"]').count(), 1)
  await page.locator('#mobile').getByRole('link').click()
  assert.deepEqual(await page.evaluate(() => window.opened), [
    'https://github.com/team/repo/pull/42/files#note',
  ])
  assert.match(await page.locator('#mobile').textContent(), /Keep  two spaces & <tags>\./)
  await show('Authored [link](https://dovo-reference.invalid/0) and @src/real.ts')
  await desktop.locator('[data-reference-kind="file"]').waitFor()
  assert.deepEqual(await desktop.locator('.dovo-composer-reference').allTextContents(), ['real.ts'])
  await page.evaluate(() => window.enableNativeMessages())
  const nativeSource = `🚀 ${source}\nhttps://github.com/team/repo/pull/42`
  await show(nativeSource)
  await page.locator('#mobile [data-native-message]').waitFor()
  assert.equal(await page.evaluate(() => window.messageNativeProps.text), nativeSource)
  assert.deepEqual(
    await page.evaluate(() => window.messageNativeProps.references.map(({ label }) => label)),
    ['file.ts', 'review', 'docs', 'claude-fable-5-2', 'end.ts'],
  )
  assert.equal(
    await page.evaluate(() => window.messageNativeProps.references[3].provider),
    'claude',
  )
  assert.deepEqual(await page.evaluate(() => window.messageNativeProps.links), [
    {
      start: nativeSource.indexOf('https://'),
      end: nativeSource.length,
      url: 'https://github.com/team/repo/pull/42',
    },
  ])
  await page.evaluate(() =>
    window.messageNativeProps.onLink(window.messageNativeProps.links[0].url),
  )
  assert.equal(
    await page.evaluate(() => window.opened.at(-1)),
    'https://github.com/team/repo/pull/42',
  )
  const botSource =
    'Ask @Dory van 🌷 (`studio:host-a:thread:dory`) and @Dory (`studio:host-b:thread:dory`)'
  await show(botSource)
  await desktop.locator('[data-reference-kind="bot"]').nth(1).waitFor()
  assert.deepEqual(await desktop.locator('[data-reference-kind="bot"]').allTextContents(), [
    '@Dory van 🌷',
    '@Dory',
  ])
  assert.equal(
    await desktop.locator('[data-reference-kind="bot"]').first().getAttribute('title'),
    '@Dory van 🌷 (`studio:host-a:thread:dory`)',
  )
  await page.waitForFunction(() => window.messageNativeProps.text.startsWith('Ask @Dory'))
  assert.deepEqual(
    await page.evaluate(() =>
      window.messageNativeProps.references.map(({ kind, label, start, end }) => [
        kind,
        label,
        window.messageNativeProps.text.slice(start, end),
      ]),
    ),
    [
      ['bot', '@Dory van 🌷', '@Dory van 🌷 (`studio:host-a:thread:dory`)'],
      ['bot', '@Dory', '@Dory (`studio:host-b:thread:dory`)'],
    ],
  )
  await desktop.screenshot({ path: '/tmp/dovo-bot-message-chips.png' })
  assert.deepEqual(referenceRequests, [])
  assert.deepEqual(errors, [])
  console.log(
    'User message references: composer labels/icons, scoped agents, end tokens, literal code/links, assistant isolation, narrow wrapping and mobile fallback/PR links passed (native controls adapted).',
  )
} catch (error) {
  console.log(await browser.contexts()[0]?.pages()[0]?.locator('#desktop').innerHTML())
  throw error
} finally {
  await browser.close()
}
