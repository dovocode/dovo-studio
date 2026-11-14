import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const browser = await chromium.launch()
try {
  for (const platform of ['desktop', 'mobile']) {
    const folder =
      root +
      (platform === 'desktop'
        ? 'packages/extension-tasks/src/chat/thread/'
        : 'apps/mobile/src/tasks/conversation/components/')
    const contents = `import {useState} from 'react';import{createRoot}from'react-dom/client';
import {${platform === 'desktop' ? 'ChatMessage' : 'MessageActions'}} from '${folder}${platform === 'desktop' ? 'chat-message' : 'message-actions'}';
window.task={id:'task',messages:[],status:'idle'};
function App(){const[draft,setDraft]=useState('Unsent work');const[user,setUser]=useState(false);window.setUser=setUser;window.append=prompt=>setDraft(value=>[value.trimEnd(),prompt].filter(Boolean).join('\\n\\n'));return <><textarea aria-label="Draft" value={draft} onChange={event=>setDraft(event.target.value)}/>${platform === 'desktop' ? '<ChatMessage taskId="task" message={{id:"assistant-1",role:user?"user":"assistant",text:"Answer "+"x".repeat(12000)}} tools={[]} compactions={[]} highlighted={false} pending={null} taskRunning={false} connected={false} request={()=>{throw Error("Unexpected mutation")}} onUseTemplate={window.append}/>' : '<MessageActions text={"Answer "+"x".repeat(12000)} user={user} messageId="assistant-1"/>'}</>};createRoot(document.getElementById('app')).render(<App/>);`
    const stubs =
      platform === 'desktop'
        ? [
            {
              path: '@dovo/studio-core',
              contents: `export * from '@dovo/protocol';export {completedStreamingText} from './packages/studio-core/src/streaming-text';export const formatDateTime=value=>value;export const useAppPreferences=()=>({});`,
            },
            {
              path: '@dovo/studio-ui',
              contents: `export const Message=({children})=><article>{children}</article>;export const MessageContent=Message;export const Button=({children,size,variant,...props})=><button {...props}>{children}</button>;`,
            },
            ...[
              ['./watch-message', 'WatchMessageCard'],
              ['./message-source', 'MessageSource'],
              ['./turn-checkpoint', 'TurnCheckpoint'],
              ['../composer/message-attachments', 'MessageAttachments'],
              ['./message-copy', 'MessageCopy'],
              ['../actions/run-in-terminal', 'RunInTerminal'],
              ['../actions/fork-turn', 'ForkTurn'],
              ['../actions/retry-turn', 'RetryTurn'],
              ['./task-activity', 'TaskActivity'],
            ].map(([path, name]) => ({
              path,
              importer: folder,
              contents: `export const ${name}=()=>null;`,
            })),
            {
              path: './task-message-response',
              importer: folder,
              contents: `export const TaskMessageResponse=({children})=><p>{children}</p>;`,
            },
          ]
        : [
            {
              path: 'react-native',
              contents: `export const Platform={OS:'ios'};export const AccessibilityInfo={announceForAccessibility(){}};export const Alert={alert(){}};export const ActionSheetIOS={showActionSheetWithOptions(){}};export const View=({children})=><div>{children}</div>;export const Pressable=({children,accessibilityLabel,onPress})=><button aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;`,
            },
            {
              path: '../../../agents/use-model-catalog',
              importer: folder,
              contents: `export const loadMobileModelCatalog=()=>{throw Error('Unexpected model read')};`,
            },
            {
              path: '../../../ui/controls/icon',
              importer: folder,
              contents: `export const Icon=()=>null;`,
            },
            {
              path: '../../../ui/content/text',
              importer: folder,
              contents: `export const Text=({children})=><span>{children}</span>;`,
            },
            {
              path: '../../../ui/theme',
              importer: folder,
              contents: `export const useTheme=()=>({colors:{muted:'#aaa'}});`,
            },
            {
              path: '../../../ui/content/clipboard',
              importer: folder,
              contents: `export const copyText=async()=>{};export const shareText=async()=>{};`,
            },
            {
              path: '../../../runtime/connection/provider',
              importer: folder,
              contents: `export const useRuntime=()=>({connected:false,call:()=>{throw Error('Unexpected mutation')}});`,
            },
            {
              path: '../state/provider',
              importer: folder,
              contents: `export const useAppendConversationTemplate=()=>window.append;export const useConversationSelector=selector=>selector({task:window.task,history:{setBookmark:()=>{}}});`,
            },
            { path: 'expo-router', contents: `export const router={};` },
            {
              path: '../../../shell/task-route',
              importer: folder,
              contents: `export const taskHref=()=>'/task';`,
            },
          ]
    const built = await bundleBrowser(
      {
        stdin: { contents, resolveDir: root, loader: 'tsx' },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        nodePaths: [root + 'packages/studio-ui/node_modules'],
        alias: {
          react: root + 'packages/studio-ui/node_modules/react',
          'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
          '@dovo/protocol': root + 'packages/protocol/src/index.ts',
        },
      },
      stubs,
    )
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.getByRole('textbox', { name: 'Draft' }).fill('Latest unsent work')
    await page.getByRole('button', { name: 'Reply to response', exact: true }).click()
    const draft = await page.getByRole('textbox', { name: 'Draft' }).inputValue()
    assert.ok(draft.startsWith('Latest unsent work\n\n'))
    assert.ok(draft.includes('assistant-1'))
    assert.ok(draft.includes('conversation_read'))
    assert.ok(draft.length < 750)
    await page.evaluate(() => window.setUser(true))
    await page
      .getByRole('button', { name: 'Reply to response', exact: true })
      .waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      platform +
        ' response reply: correct assistant reference, bounded quote, latest draft and no mutation pass. Conversation and composer boundaries use fixtures.',
    )
  }
} finally {
  await browser.close()
}
