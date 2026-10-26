import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const literalMessage =
  'Dovo PR feedback for https://github.com/foreign/project/pull/42/files#note.\nHead: abc123\n\nreview by Dominic (CHANGES_REQUESTED)\nKeep  two spaces, a\ttab, punctuation & <tags>, and **literal Markdown**.\n\n  Indented final line.\n'
const environment = `export const reducedMotion=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
import {createContext,useContext} from 'react';
export * from '@dovo/protocol';
export const updateTask=(w,id,change)=>({...w,tasks:w.tasks.map(task=>task.id===id?change(task):task)});export const Context=createContext(null);export const useWorkspace=()=>useContext(Context);
export {studioSyntaxTheme} from '${root}/packages/studio-core/src/themes.ts';export const useAppPreferences=()=>({themePalette:'dovo',codeTheme:'app',importedCodeThemes:[]});export const useResolvedTheme=()=> 'dark';
export const useRuntime=useWorkspace;export const useConversationSelector=select=>{const value=useWorkspace();return select({task:value.workspace.tasks[0],actions:{threadScope:JSON.stringify([value.connection.address,value.connection.token,value.workspace.tasks[0].id])}})};
export const useStudioHost=()=>({...useWorkspace().host,openExternalLink:async url=>{window.external.push(url)},openBrowserLink:async url=>{window.browsers.push(url)},openPullLink:url=>{window.opened.push(url);return true}});
`
const fixture = `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {TooltipProvider} from '@radix-ui/react-tooltip';import {Effect} from 'effect';import {addTaskPullLinks} from '@dovo/protocol';import {Context} from '@dovo/studio-core';
window.writes=[];window.copied=[];window.opened=[];window.external=[];window.browsers=[];window.alerts=[];window.fail=false;
const url='https://github.com/foreign/project/pull/42/files#note';
const initial={id:'thread',title:'Thread',repositoryId:'original-project',status:'draft',messages:[{id:'m',role:'assistant',text:url}],files:[],draft:'',example:false};
function App(){CHOOSER_STATE const[task,setTask]=useState(initial),[connected,setConnected]=useState(true),[runtime,setRuntime]=useState('http://runtime.local'),[manage,setManage]=useState(false);window.setTask=setTask;window.connect=setConnected;window.runtime=setRuntime;
const request=async(path,input)=>{window.writes.push({path,input,runtime});if(path==='/api/tasks/message/bookmark'){setTask(task=>({...task,messages:task.messages.map(message=>message.id===input.messageId?{...message,bookmarked:input.bookmarked}:message)}));return {ok:true}};if(path==='/api/scm/pulls/detail')return {pull:{number:input.number,title:'Resolved project PR',url:'https://github.com/original/project/pull/'+input.number,repositoryUrl:'https://github.com/original/project',provider:'github'}};if(window.fail)throw new Error('Link failed');setTask(current=>addTaskPullLinks(current,input.pulls));return {ok:true}};
const value={host:CHOOSER_HOST,activeRuntimeId:runtime,workspace:{tasks:[task],repositories:[]},activeId:runtime,overviews:[{profile:{id:runtime,name:'Computer',connection:{address:runtime,token:'paired'}},snapshot:{workspace:{repositories:[]}}}],snapshot:{workspace:{tasks:[task]}},call:request,connected,connection:{address:runtime,token:'paired'},profile:{connection:{address:runtime,token:'paired'}},request,callEffect:(...args)=>Effect.tryPromise({try:()=>request(...args),catch:error=>error})};
return <Context.Provider value={value}>CHOOSER_DIALOG CONTENT</Context.Provider>};createRoot(document.getElementById('app')).render(<TooltipProvider><App/></TooltipProvider>);
`
async function bundle(mobile) {
  const mocks = {
    // Native syntax rendering is covered by check-mobile-review-browser.
    './code-block': 'export const CodeBlock=({content})=><pre>{content}</pre>;',
    // File previews are exercised by check-chat-files-browser; this suite verifies PR links.
    './rich-file': `export const RichFile=()=>null;export const TemplateCard=()=>null;`,
    './server-image': `export const ServerImage=()=>null;`,
    '@dovo/studio-core': environment,
    '@dovo/studio-core/state': `export {useState as useApplicationState} from 'react';`,
    '@dovo/client-runtime': `import {TooltipProvider} from '@radix-ui/react-tooltip';import {Effect} from 'effect';export const runClientEffect=Effect.runPromise;`,
    './task-activity': `export const useTaskActivity=()=>({tools:[],error:''});export const TaskActivity=()=>null;`,
    './turn-label': `export const TurnLabel=()=>null;`,
    './deferred-turn': `export const DeferredTurn=({children})=>children();`,
    './chat-message': `import {MessageResponse} from '${root}/packages/studio-ui/src/components/ai-elements/message.tsx';export const ChatMessage=({message})=><div id={'message-thread-'+message.id}><p>Message context text</p><MessageResponse>{'[Thread PR]('+message.text+')'}</MessageResponse><div data-empty>Conversation space</div></div>;`,
    '../../runtime/connection/provider': `export {useRuntime} from '@dovo/studio-core';`,
    '../../../runtime/connection/provider': `export {useRuntime} from '@dovo/studio-core';`,
    '../state/provider': `export {useConversationSelector} from '@dovo/studio-core';`,
    '../layout/sheet': `import {useImperativeHandle} from 'react';export const useSheetNavigation=()=>navigate=>navigate();export const Sheet=({title,children,onClose,busy,ref})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();after?.()}}));return <section role="dialog"><h2>{title}</h2>{children}<button disabled={busy} onClick={onClose}>Close</button></section>};`,
    '../layout/safe-modal': `export const SafeModal=({visible,children})=>visible?children:null;`,
    '../controls/action': `export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    'expo-clipboard': `export const setStringAsync=async value=>window.copied.push(value);`,
    'expo-router': `export const usePathname=()=>'/thread';export const router={push:href=>window.opened.push(href.params.navigationUrl??href.params.url??href.params.repositoryId)};`,
    'react-native-webview': `export default ()=>null;`,
    '../../runtime/preferences/app-preferences': `export const useCarMode=()=>false;export const carZoom=1.5;`,
    '../../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../runtime/state/application-state': `export {useState as useApplicationState} from 'react';`,
    '../../../ui/controls/action': `export const Action=({label,disabled,onPress})=><button disabled={disabled} onClick={onPress}>{label}</button>;`,
    '../../../ui/layout/sheet': `import {useImperativeHandle} from 'react';export const Sheet=({title,children,onClose,busy,ref})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();after?.()}}));return <section role="dialog"><h2>{title}</h2>{children}<button disabled={busy} onClick={onClose}>Close</button></section>};`,
    '../../../ui/content/text': `export {Text} from 'react-native';`,
    './text': `export {Text} from 'react-native';`,
    '../../../ui/theme': `export const styles={};export const colors={};export const useTheme=()=>({styles,colors,mode:'dark'});`,
    '../theme': `export const styles={chatText:{}};export const colors={};export const useTheme=()=>({styles,colors,mode:'dark'});`,
    './mermaid-diagram': `export const MermaidDiagram=()=>null;`,
    './task-visualization': `export const TaskVisualization=()=>null;`,
    'react-native': `export const View=({children})=><div>{children}</div>;export const Text=({children,onPress,onLongPress})=>onPress?<a href="#" onClick={e=>{e.preventDefault();onPress()}} onContextMenu={e=>{e.preventDefault();onLongPress?.()}}>{children}</a>:<span>{children}</span>;export const Keyboard={dismiss:()=>{}};export const Linking={openURL:async url=>window.external.push(url)};export const Platform={OS:'ios'};export const Alert={alert:(...args)=>window.alerts.push(args)};`,
    'react-native-enriched-markdown': `export const EnrichedMarkdownText=({markdown,onLinkPress,onLinkLongPress})=>{const url=markdown.match(/\\]\\(<([^>]+)>\\)/)?.[1]??markdown;return <a href={url} onClick={e=>{e.preventDefault();onLinkPress({url})}} onContextMenu={e=>{e.preventDefault();onLinkLongPress?.({url})}}>{markdown.includes('&#')?url:'Thread PR'}</a>};`,
  }
  const ui = `${root}/packages/studio-ui/src/components`
  if (!mobile)
    mocks['@dovo/studio-ui'] =
      `export * as ContextMenu from '@radix-ui/react-context-menu';export {Button} from '${ui}/ui/button.tsx';export {Input} from '${ui}/ui/input.tsx';export {IconButton} from '${ui}/icon-button.tsx';export {Dialog,DialogContent,DialogTitle,DialogDescription} from '${ui}/ui/dialog.tsx';export const Conversation=({children,...props})=><div {...props}>{children}</div>;export const ConversationContent=({children})=><div>{children}</div>;export const ConversationHistory=ConversationContent;export const ConversationRail=()=>null;export const ConversationScrollButton=()=>null;`
  const renderedFixture = fixture
    .replace(
      'CHOOSER_STATE',
      mobile
        ? ''
        : `const chooser=useLinkChooser({origin:()=>({runtimeId:runtime}),targets:(url,origin)=>resolveLinkTargets(url,value.overviews,origin),details:target=>window.opened.push(target.navigationUrl??target.url),browser:url=>window.browsers.push(url),external:url=>window.external.push(url),onError:error=>window.alerts.push(String(error))});`,
    )
    .replace(
      'CHOOSER_HOST',
      mobile ? '{}' : '{openLink:chooser.openLink,getLinkActions:chooser.getLinkActions}',
    )
    .replace('CHOOSER_DIALOG', mobile ? '<LinkBrowser/>' : '{chooser.dialog}')
  const entry = mobile
    ? `import {LinkBrowser} from '${root}/apps/mobile/src/ui/content/open-link.tsx';import {ThreadMarkdown} from '${root}/apps/mobile/src/tasks/conversation/components/thread-markdown.tsx';${renderedFixture.replace('CONTENT', `<><ThreadMarkdown text={url} variant="chat"/><div data-literal><ThreadMarkdown text={${JSON.stringify(literalMessage)}} plainText/></div></>`)}`
    : `import {resolveLinkTargets} from '@dovo/studio-core/links';import {useLinkChooser} from '${root}/packages/studio-shell/src/link-chooser.tsx';import {TaskPullLinkDialog} from '${root}/packages/extension-tasks/src/dialogs/task-pull-link-dialog.tsx';import {ChatThread} from '${root}/packages/extension-tasks/src/chat/thread/chat-thread.tsx';${renderedFixture.replace('CONTENT', '<><ChatThread task={task} onPullLink={url=>{window.opened.push(url);return true}} onManagePulls={()=>setManage(true)}/>{manage&&<TaskPullLinkDialog task={task} onClose={()=>setManage(false)}/>}</>')}`
  const result = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
    alias: {
      react: `${root}/packages/studio-ui/node_modules/react`,
      'react-dom': `${root}/packages/studio-ui/node_modules/react-dom`,
      '@dovo/protocol': `${root}/packages/protocol/src/index.ts`,
    },
    nodePaths: [`${root}/packages/studio-ui/node_modules`],
    plugins: [
      {
        name: 'boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(mocks, path) ? { path, namespace: 'mock' } : undefined,
          )
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({
            contents: mocks[path],
            loader: 'tsx',
            resolveDir: `${root}/packages/studio-ui`,
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
  return result.outputFiles[0].text
}
const browser = await chromium.launch()
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage()
    page.setDefaultTimeout(8000)
    const errors = []
    const popups = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('popup', (popup) => popups.push(popup.url()))
    await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle(mobile) })
    const link = page.getByRole('link', { name: 'Thread PR', exact: true })
    if (mobile) {
      await page.locator('[data-literal]').waitFor()
      assert.equal(
        await page.locator('[data-literal]').textContent(),
        literalMessage,
        'User messages must preserve every space, newline and punctuation mark around PR links',
      )
    }
    if (!mobile) {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.copied.push(text)
            },
          },
        })
      })
      // The first interaction is a right-click, before any link has been activated.
      await link.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Copy link', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.copied), [
        'https://github.com/foreign/project/pull/42/files#note',
      ])
      const prose = page.getByText('Message context text', { exact: true })
      await prose.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Copy message', exact: true }).click()
      assert.equal(
        await page.evaluate(() => window.copied.at(-1)),
        'https://github.com/foreign/project/pull/42/files#note',
      )
      await prose.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        window.getSelection().removeAllRanges()
        window.getSelection().addRange(range)
      })
      await prose.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Copy selected text', exact: true }).click()
      assert.equal(await page.evaluate(() => window.copied.at(-1)), 'Message context text')
      await page.evaluate(() => window.getSelection().removeAllRanges())
      await page.locator('[data-empty]').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Find in thread', exact: true }).click()
      await page.getByRole('searchbox', { name: 'Search this thread' }).waitFor()
      await page.getByRole('button', { name: 'Close thread search' }).click()
      await prose.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Bookmark reply', exact: true }).click()
      await page.waitForFunction(() => window.writes.length === 1)
      const bookmark = await page.evaluate(() => window.writes[0])
      assert.equal(bookmark.path, '/api/tasks/message/bookmark')
      assert.deepEqual(bookmark.input, { id: 'thread', messageId: 'm', bookmarked: true })
      await prose.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Remove bookmark', exact: true }).waitFor()
      await page.getByRole('menuitem', { name: 'Copy conversation', exact: true }).click()
      assert.ok(
        (await page.evaluate(() => window.copied.at(-1))).includes(
          'https://github.com/foreign/project/pull/42/files#note',
        ),
      )
      await page.evaluate(() => {
        window.writes = []
      })
    }
    await link.click()
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.getByRole('button', { name: 'Open PR details', exact: true }).click()
    await page.waitForFunction(() => window.opened.length === 1)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.evaluate(() => {
      window.opened = []
    })
    if (!mobile) {
      // Exercise the real Markdown renderer: its default link-safety buttons
      // used to bypass ChatThread and open an additional Electron chooser.
      await link.click()
      await page.getByRole('button', { name: 'Open in Dovo browser', exact: true }).click()
      await page.waitForFunction(() => window.browsers.length === 1)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.deepEqual(await page.evaluate(() => window.browsers), [
        'https://github.com/foreign/project/pull/42/files#note',
      ])
      await link.click()
      await page.getByRole('button', { name: 'Open in external browser', exact: true }).click()
      await page.waitForFunction(() => window.external.length === 1)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.deepEqual(await page.evaluate(() => window.external), [
        'https://github.com/foreign/project/pull/42/files#note',
      ])
      await page.evaluate(() => {
        window.external = []
      })
      await link.click()
      await page.getByRole('button', { name: 'Close', exact: true }).click()
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.deepEqual(await page.evaluate(() => window.external), [])
      assert.deepEqual(await page.evaluate(() => window.opened), [])
      assert.equal(await page.evaluate(() => window.browsers.length), 1)
    }
    await link.click({ button: 'right' })
    if (!mobile)
      await page.getByRole('menuitem', { name: 'Link to this thread', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.evaluate(() => window.writes.length), 0)
    await page.getByRole('button', { name: 'Link to this thread', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const write = await page.evaluate(() => window.writes[0])
    assert.equal(write.path, '/api/scm/pulls/link-thread')
    assert.equal(write.input.id, 'thread')
    assert.equal(write.input.pulls[0].url, 'https://github.com/foreign/project/pull/42')
    assert.equal(await page.evaluate(() => window.writes.length), 1)
    await link.click({ button: 'right' })
    if (mobile) {
      assert.ok(
        await page.getByRole('button', { name: 'Already linked to this thread' }).isDisabled(),
      )
      await page.getByRole('button', { name: 'Open PR details', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    } else {
      assert.ok(
        await page.getByRole('menuitem', { name: 'Already linked to this thread' }).isDisabled(),
      )
      await page.getByRole('menuitem', { name: 'Open PR details', exact: true }).click()
    }
    assert.deepEqual(await page.evaluate(() => window.opened), [
      'https://github.com/foreign/project/pull/42/files#note',
    ])
    await page.evaluate(() => {
      window.setTask((task) => ({ ...task, linkedPullRequests: [] }))
      window.connect(false)
    })
    await link.click({ button: 'right' })
    if (!mobile)
      await page.getByRole('menuitem', { name: 'Link to this thread', exact: true }).click()
    assert.ok(
      await page.getByRole('button', { name: 'Link to this thread', exact: true }).isDisabled(),
    )
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => {
      window.connect(true)
      window.setTask((task) => ({ ...task, archivedAt: 'now' }))
    })
    await link.click({ button: 'right' })
    if (!mobile)
      await page.getByRole('menuitem', { name: 'Link to this thread', exact: true }).click()
    assert.ok(
      await page.getByRole('button', { name: 'Link to this thread', exact: true }).isDisabled(),
    )
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.evaluate(() => {
      window.setTask((task) => ({ ...task, archivedAt: undefined }))
      window.fail = true
    })
    await link.click({ button: 'right' })
    if (!mobile)
      await page.getByRole('menuitem', { name: 'Link to this thread', exact: true }).click()
    await page.getByRole('button', { name: 'Link to this thread', exact: true }).click()
    await page.getByText(/Link failed/, { exact: false }).waitFor()
    await page.evaluate(() => {
      window.fail = false
    })
    await page.getByRole('button', { name: 'Link to this thread', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await link.click({ button: 'right' })
    await page.evaluate(() => window.runtime('http://other-runtime.local'))
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    if (mobile) {
      await page.getByRole('link', { name: /https:\/\/github.com/ }).click({ button: 'right' })
      await page.getByRole('dialog').waitFor()
      assert.ok(
        await page.getByRole('button', { name: 'Already linked to this thread' }).isDisabled(),
      )
    }
    if (!mobile) {
      await page.evaluate(() => {
        window.copied = []
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: async (url) => window.copied.push(url) },
          configurable: true,
        })
        window.setTask((task) => ({
          ...task,
          messages: [
            {
              id: 'ordinary',
              role: 'assistant',
              text: 'http://runtime.local/docs?tab=one#section',
            },
          ],
        }))
      })
      await page.keyboard.press('Escape')
      await page.locator('#app').dispatchEvent('contextmenu')
      assert.equal(await page.getByRole('menu').count(), 0)
      const ordinary = page.getByRole('link', { name: 'Thread PR', exact: true })
      await ordinary.click()
      await page.getByRole('dialog').waitFor()
      assert.equal(await page.getByRole('dialog').count(), 1)
      assert.equal(await page.getByRole('button', { name: 'Open PR details' }).count(), 0)
      await page.getByRole('button', { name: 'Close', exact: true }).click()
      await ordinary.click({ button: 'right' })
      assert.equal(await page.getByRole('menuitem', { name: 'Open PR details' }).count(), 0)
      await page.getByRole('menuitem', { name: 'Copy link', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.copied), [
        'http://runtime.local/docs?tab=one#section',
      ])
      await ordinary.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Open in external browser', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.external), [
        'http://runtime.local/docs?tab=one#section',
      ])
      await page.evaluate(() => {
        navigator.clipboard.writeText = async () => {
          throw new Error('Clipboard denied')
        }
      })
      await ordinary.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Copy link', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Clipboard denied' }).waitFor()
    }
    if (!mobile) {
      await page.evaluate(() => {
        window.setTask((task) => ({ ...task, repositoryId: '', linkedPullRequests: [] }))
      })
      await page.locator('[data-empty]').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Manage linked pull requests', exact: true }).click()
      const reference = page.getByRole('textbox', { name: 'Pull request number or URL' })
      await reference.fill('https://github.com/outside/another-project/pull/99/files#note')
      const count = await page.evaluate(() => window.writes.length)
      await page.getByRole('button', { name: 'Link PR', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('input[aria-label="Pull request number or URL"]').value === '',
      )
      const calls = await page.evaluate((count) => window.writes.slice(count), count)
      assert.equal(calls.length, 1)
      assert.equal(calls[0].path, '/api/scm/pulls/link-thread')
      assert.equal(
        calls[0].input.pulls[0].url,
        'https://github.com/outside/another-project/pull/99',
      )
      await reference.fill('https://github.com/outside/another-project/pull/99')
      await page.getByRole('button', { name: 'Link PR', exact: true }).click()
      await page.getByText('This PR is already linked.', { exact: true }).waitFor()
      await reference.fill('#12')
      await page.getByRole('button', { name: 'Link PR', exact: true }).click()
      await page
        .getByText('Use a full PR URL when this thread has no project.', { exact: true })
        .waitFor()
      await page.evaluate(() =>
        window.setTask((task) => ({ ...task, repositoryId: 'original-project' })),
      )
      await page.getByRole('button', { name: 'Link PR', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('input[aria-label="Pull request number or URL"]').value === '',
      )
      const latest = await page.evaluate(() => window.writes.slice(-2))
      assert.equal(latest[0].path, '/api/scm/pulls/detail')
      assert.equal(latest[0].input.repositoryId, 'original-project')
      assert.equal(latest[1].input.pulls[0].title, 'Resolved project PR')
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(popups, [])
    await page.close()
  }
  console.log(
    'Thread PR links: desktop normal click/right-click, mobile normal tap/long-press and plain user links, normalized cross-project links, duplicate/offline/archive guards, failure recovery, native opening and runtime switching passed.',
  )
} finally {
  await browser.close()
}
