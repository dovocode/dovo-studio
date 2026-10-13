import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser } from './harness.mjs'

// Both real deferred components, native observers and the real Conversation scroll context.
// Interaction starts after the pinned item is already distant, so no observer hold can hide
// the render-before-effect race when its pin is removed.
export async function checkPinRemoval(browser, kind) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const built = await bundleBrowser(
    {
      stdin: {
        resolveDir: root,
        loader: 'tsx',
        contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Conversation,ConversationContent,ConversationHistory} from './packages/studio-ui/src/components/ai-elements/conversation.tsx';
import {DeferredTurn} from './packages/extension-tasks/src/chat/thread/deferred-turn.tsx';
import {DeferredPullFile} from './packages/extension-scm/src/pulls/detail/deferred-file.tsx';
const kind=${JSON.stringify(kind)},heights=new Map(),file={path:'focus.txt',status:'modified',patch:''};
function Probe(){const [pinned,setPinned]=useState(true);window.setPin=value=>flushSync(()=>setPinned(value));
const child=<div id="pin-content"><button id="pin-focus">Keep focus</button><p id="pin-text">Selected text must survive</p></div>;
const item=kind==='turn'?<DeferredTurn id="pin-turn" pinned={pinned}>{()=>child}</DeferredTurn>:<DeferredPullFile file={file} pinned={pinned} heights={heights}>{child}</DeferredPullFile>;
const content=<>{item}<div style={{height:8000,flexShrink:0}}>Distant end</div></>;
return kind==='turn'?<div style={{height:300,display:'flex',flexDirection:'column'}}><Conversation><ConversationHistory><ConversationContent>{content}</ConversationContent></ConversationHistory></Conversation></div>:<div id="pin-scroll" style={{height:300,overflowY:'auto'}}>{content}</div>}
createRoot(document.getElementById('app')).render(<Probe/>);
`,
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      alias: {
        react: root + 'packages/studio-ui/node_modules/react',
        'react-dom': root + 'packages/studio-ui/node_modules/react-dom',
      },
      nodePaths: [root + 'packages/studio-ui/node_modules'],
    },
    [
      {
        path: '@dovo/studio-ui',
        contents: `export * from '${root}packages/studio-ui/src/components/ai-elements/conversation.tsx';export {Button} from '${root}packages/studio-ui/src/components/ui/button.tsx';`,
      },
      {
        path: '@dovo/studio-core/state',
        contents: `export {useState as useApplicationState} from 'react';`,
      },
    ],
  )
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent(
      `<style>.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.min-h-0{min-height:0}.overflow-y-hidden{overflow-y:hidden}</style><div id="app"></div>`,
    )
    await page.addScriptTag({ content: built.outputFiles[0].text })
    await page.locator('#pin-content').waitFor()
    const scroller = kind === 'turn' ? '[role=log] > div' : '#pin-scroll'
    await page.evaluate((selector) => {
      const root = document.querySelector(selector)
      root.scrollTop = root.scrollHeight
    }, scroller)
    // Native observers deliver the leaving event before interaction starts. The item's pin
    // alone now keeps it mounted; focus/selection have never set the held state.
    await page.waitForTimeout(200)
    assert.ok(
      await page.evaluate(
        (selector) => document.querySelector(selector).scrollTop > 7000,
        scroller,
      ),
    )
    for (const interaction of ['focus', 'selection']) {
      await page.evaluate((interaction) => {
        window.setPin(true)
        const content = document.getElementById('pin-content')
        window.removedPinContent = false
        window.pinObserver = new MutationObserver((records) => {
          for (const record of records)
            for (const node of record.removedNodes)
              if (node === content || node.contains?.(content)) window.removedPinContent = true
        })
        window.pinObserver.observe(document.getElementById('app'), {
          childList: true,
          subtree: true,
        })
        if (interaction === 'focus')
          document.getElementById('pin-focus').focus({ preventScroll: true })
        else {
          const text = document.getElementById('pin-text').firstChild
          const range = document.createRange()
          range.setStart(text, 0)
          range.setEnd(text, 13)
          getSelection().addRange(range)
        }
        window.setPin(false)
      }, interaction)
      await page.waitForTimeout(50)
      const state = await page.evaluate(() => ({
        mounted: !!document.getElementById('pin-content'),
        removed: window.removedPinContent,
        focused: document.activeElement.id,
        selection: getSelection().toString(),
      }))
      assert.equal(
        state.mounted,
        true,
        `${kind}: ${interaction} lost its mounted content when unpinned`,
      )
      assert.equal(state.removed, false, `${kind}: ${interaction} content was transiently detached`)
      if (interaction === 'focus') assert.equal(state.focused, 'pin-focus')
      else assert.equal(state.selection, 'Selected text')
      await page.evaluate(() => {
        window.pinObserver.disconnect()
        document.activeElement.blur()
        getSelection().removeAllRanges()
        // Removing selected text dispatches selectionchange asynchronously; focusout also
        // exercises the release listeners for the focus-only case.
      })
      await page.locator('#pin-content').waitFor({ state: 'detached' })
    }
    assert.deepEqual(errors, [])
    console.log(
      `${kind} pin removal: offscreen focus and selected text survived the commit, then released after interaction ended.`,
    )
  } finally {
    await page.close()
  }
}
