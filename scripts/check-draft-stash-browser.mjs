import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const mobile = root + 'apps/mobile/'
const native = `
import {useImperativeHandle} from 'react';
export const View=({children})=><div>{children}</div>;
export const Text=({children,accessibilityRole})=><p role={accessibilityRole}>{children}</p>;
export const Action=({label,onPress,disabled})=><button disabled={disabled} onClick={onPress}>{label}</button>;
export const IconButton=({label,onPress,disabled})=><button aria-label={label} disabled={disabled} onClick={onPress}/>;
export const Sheet=({title,children,onClose,ref})=>{useImperativeHandle(ref,()=>({dismiss:after=>{onClose();queueMicrotask(after)}}));return <div role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></div>};
export const useTheme=()=>({styles:{}});
`
const browser = await chromium.launch()
try {
  for (const platform of ['desktop', 'mobile']) {
    const built = await bundleBrowser(
      {
        stdin: {
          resolveDir: root + 'packages/extension-tasks',
          loader: 'tsx',
          contents: `
import {useRef,useState} from 'react';import {flushSync} from 'react-dom';import {createRoot} from 'react-dom/client';
import {draftStashScope} from '@dovo/protocol';
import {TooltipProvider} from '${root}packages/studio-ui/src/components/ui/tooltip';
import {DraftStash} from '${root + (platform === 'desktop' ? 'packages/extension-tasks/src/chat/composer/draft-stash.tsx' : 'apps/mobile/src/tasks/composer/draft-stash.tsx')}';
function App(){
 const [text,setText]=useState('Original prompt'),[owner,setOwner]=useState('local'),[attachments,setAttachments]=useState(false),[mounted,setMounted]=useState(true);const input=useRef(null);
 window.setText=value=>flushSync(()=>setText(value));window.changeOwner=value=>flushSync(()=>setOwner(value));window.attach=value=>flushSync(()=>setAttachments(value));window.mount=value=>flushSync(()=>setMounted(value));window.scope=draftStashScope(owner,'thread');window.text=text;
 return <><textarea aria-label="Draft" ref={input} value={text} onChange={e=>setText(e.target.value)}/>{mounted&&<DraftStash key={owner} scope={window.scope} getText={()=>text} onChange={setText} focus={()=>input.current.focus()} hasAttachments={attachments}/>}</>;
}
createRoot(document.getElementById('app')).render(<TooltipProvider><App/></TooltipProvider>);
`,
        },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        jsx: 'automatic',
        conditions: ['development'],
        alias: { react: root + 'packages/studio-ui/node_modules/react' },
        nodePaths: [root + 'packages/studio-ui/node_modules', root + 'node_modules'],
      },
      platform === 'desktop'
        ? [
            {
              path: '@dovo/studio-ui',
              contents: `export {Button} from '${root}packages/studio-ui/src/components/ui/button';export {IconButton} from '${root}packages/studio-ui/src/components/icon-button';export {Dialog,DialogContent,DialogDescription,DialogTitle} from '${root}packages/studio-ui/src/components/ui/dialog';`,
            },
          ]
        : [
            { path: 'react-native', contents: native },
            ...[
              '../../ui/content/text',
              '../../ui/controls/action',
              '../../ui/controls/icon-button',
              '../../ui/layout/sheet',
              '../../ui/theme',
            ].map((path) => ({ path, importer: mobile, contents: native })),
            { path: 'expo-crypto', contents: 'export const randomUUID=()=>crypto.randomUUID();' },
            {
              path: '@react-native-async-storage/async-storage',
              contents: `export default {getAllKeys:async()=>Object.keys(localStorage),getItem:async key=>localStorage.getItem(key),setItem:async(key,value)=>{if(window.holdWrite)await new Promise(resolve=>window.finishWrite=resolve);localStorage.setItem(key,value)},removeItem:async key=>localStorage.removeItem(key)};`,
            },
          ],
    )
    const page = await browser.newPage({ viewport: { width: 390, height: 760 } })
    page.setDefaultTimeout(10_000)
    const errors = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error(platform, error.message)
    })
    await page.route('http://localhost:8349/**', (route) =>
      route.fulfill({ body: '<div id="app"></div>', contentType: 'text/html' }),
    )
    await page.goto('http://localhost:8349/')
    await page.addScriptTag({ content: built.outputFiles[0].text })
    const open = async () => {
      await page.getByRole('button', { name: 'Stashed drafts', exact: true }).click()
      await page.getByRole('button', { name: 'Stash current text', exact: true }).waitFor()
    }
    const close = async () => {
      if (platform === 'desktop') await page.keyboard.press('Escape')
      else await page.getByRole('button', { name: 'Close', exact: true }).click()
      await page
        .getByRole('button', { name: 'Stash current text', exact: true })
        .waitFor({ state: 'hidden' })
    }
    const save = () => page.getByRole('button', { name: 'Stash current text', exact: true }).click()
    await open()
    await save()
    await page.waitForFunction(() => window.text === '')
    await page.getByRole('button', { name: 'Restore', exact: true }).waitFor()
    await close()
    await page.evaluate(() => {
      window.mount(false)
      window.mount(true)
      window.setText('New prompt')
    })
    await open()
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    await page.waitForFunction(
      () =>
        window.text === 'New prompt\n\nOriginal prompt' &&
        document.activeElement?.getAttribute('aria-label') === 'Draft',
    )
    await page.evaluate(() => window.changeOwner('remote'))
    await open()
    assert.equal(
      await page.getByRole('button', { name: 'Restore', exact: true }).count(),
      0,
      platform + ' isolates computers',
    )
    await close()
    await page.evaluate(() => {
      window.changeOwner('local')
      window.attach(true)
    })
    await open()
    assert.equal(
      await page.getByRole('button', { name: 'Stash current text', exact: true }).isDisabled(),
      true,
    )
    assert.equal(
      await page.getByRole('button', { name: 'Restore', exact: true }).isDisabled(),
      true,
    )
    await close()
    await page.evaluate(() => {
      window.attach(false)
      window.setText('Must survive failure')
      window.originalSetItem = Storage.prototype.setItem.bind(localStorage)
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('dovo.draft-stash.'))
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        return window.originalSetItem.call(this, key, value)
      }
    })
    await open()
    await save()
    await page.getByRole('alert').waitFor()
    assert.equal(
      await page.locator('textarea[aria-label="Draft"]').inputValue(),
      'Must survive failure',
    )
    await close()
    await page.evaluate(() => {
      Storage.prototype.setItem = window.originalSetItem
    })
    if (platform === 'mobile') {
      await page.evaluate(() => {
        window.holdWrite = true
        window.setText('Pending save')
      })
      await open()
      await save()
      await page.waitForFunction(() => !!window.finishWrite)
      await page.evaluate(() => {
        window.setText('Newer typing')
        window.holdWrite = false
        window.finishWrite()
      })
      await page.waitForFunction(() => document.querySelectorAll('button').length > 4)
      assert.equal(await page.locator('textarea[aria-label="Draft"]').inputValue(), 'Newer typing')
      await close()
      await page.evaluate(() => {
        window.holdWrite = true
        window.finishWrite = null
        window.setText('Old computer draft')
      })
      await open()
      await save()
      await page.waitForFunction(() => !!window.finishWrite)
      await page.evaluate(() => {
        window.changeOwner('other')
        window.setText('Other computer draft')
        window.holdWrite = false
        window.finishWrite()
      })
      await page.waitForFunction(() =>
        Object.values(localStorage).some((raw) => raw.includes('Old computer draft')),
      )
      assert.equal(
        await page.locator('textarea[aria-label="Draft"]').inputValue(),
        'Other computer draft',
      )
      await page.evaluate(() => window.changeOwner('local'))
    }
    await open()
    while (await page.getByRole('button', { name: 'Delete stashed draft', exact: true }).count()) {
      const before = await page
        .getByRole('button', { name: 'Delete stashed draft', exact: true })
        .count()
      await page.getByRole('button', { name: 'Delete stashed draft', exact: true }).first().click()
      await page.waitForFunction(
        (count) =>
          Array.from(document.querySelectorAll('button')).filter(
            (button) =>
              button.getAttribute('aria-label') === 'Delete stashed draft' ||
              button.textContent === 'Delete stashed draft',
          ).length < count,
        before,
      )
    }
    await close()
    await page.evaluate(() => localStorage.setItem(window.scope + 'broken', '{'))
    await open()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem(window.scope + 'broken')), '{')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(
      platform +
        ': draft stash persistence, append/focus, isolation, attachments, storage failure and deletion passed',
    )
  }
} finally {
  await browser.close()
}
