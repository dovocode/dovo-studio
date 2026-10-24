import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import { bundleBrowser, chromium } from './browser/harness.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const ui = root + 'packages/studio-ui/src/'
const mobile = root + 'apps/mobile/src/'
const native = `
const flat=s=>Array.isArray(s)?Object.assign({},...s.map(flat)):s??{};
const css=s=>{const v=flat(s);const result={...v};for(const [key,axes] of Object.entries({paddingHorizontal:['paddingLeft','paddingRight'],paddingVertical:['paddingTop','paddingBottom'],marginHorizontal:['marginLeft','marginRight']})){if(key in result){for(const axis of axes)result[axis]=result[key];delete result[key]}};if(typeof result.lineHeight==='number')result.lineHeight+='px';return result};
export const View=({children,style,accessibilityLabel,accessibilityState})=><div aria-label={accessibilityLabel} aria-busy={accessibilityState?.busy} style={{display:'flex',boxSizing:'border-box',flexDirection:'column',...css(style)}}>{children}</div>;
export const Text=({children,style})=><span style={css(style)}>{children}</span>;
export const ScrollView=View;
export const Pressable=({children,style,accessibilityLabel,accessibilityState,disabled,onPress})=><button aria-label={accessibilityLabel} aria-expanded={accessibilityState?.expanded} disabled={disabled} onClick={onPress} style={{display:'flex',boxSizing:'border-box',padding:0,border:0,font:'inherit',background:'transparent',...css(style)}}>{children}</button>;
export const SettingsAction=({label,secondary,disabled,onPress})=><button disabled={disabled} onClick={onPress} style={{minHeight:44,font:'inherit',padding:'8px 16px',border:0,borderRadius:16,background:secondary?'transparent':'#24292f',color:secondary?'#24292f':'white'}}>{label}</button>;
export const useTheme=()=>({colors:{border:'#d0d7de',background:'#fff',warning:'#9a6700'},styles:{muted:{fontSize:13,lineHeight:18},text:{fontSize:15}}});
`
const desktop = await bundleBrowser(
  {
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {SettingsSaveBar} from '${ui}settings-layout';
import * as StudioDialog from '${ui}components/ui/dialog';import * as WebDialog from '${root}packages/web-ui/src/dialog';
function App(){const [webDialog,setWebDialog]=useState(false);window.setWebDialog=setWebDialog;const {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription}=webDialog?WebDialog:StudioDialog;const [state,setState]=useState('clean'),[long,setLong]=useState(false);window.setSaveState=setState;window.setLong=setLong;return <main className="flex h-screen flex-col"><div className="overflow-y-auto flex-1" aria-label="Scrollable settings"><div className="mx-auto max-w-xl p-4"><p>Settings content</p><div style={{height:long?1600:60}}/><p data-content-end>End of settings</p></div></div><SettingsSaveBar dirty={state==='dirty'||state==='saving'} saving={state==='saving'} saved={state==='saved'} changes={[{key:'name',label:'Name',before:'Old',after:'New'}]} description="No unsaved changes" onSave={()=>setState('saving')} onDiscard={()=>setState('clean')}/><Dialog><DialogTrigger>Open dialog</DialogTrigger><DialogContent><DialogTitle>Connection settings</DialogTitle><DialogDescription>Review your computer connection.</DialogDescription><input aria-label="Connection name" defaultValue="Mac Studio"/></DialogContent></Dialog></main>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    nodePaths: [ui + '../node_modules'],
  },
  [],
)
const mobileBundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + 'apps/mobile',
      loader: 'tsx',
      contents: `
import {createRoot} from 'react-dom/client';import {useState} from 'react';import {SettingsSaveBar} from '${mobile}screens/settings-save-bar';
function App(){const [state,setState]=useState('clean');window.setSaveState=setState;return <SettingsSaveBar inline dirty={state==='dirty'||state==='saving'} saving={state==='saving'} saved={state==='saved'} changes={[{key:'name',label:'Name',before:'Old',after:'New'}]} onSave={()=>setState('saving')} onDiscard={()=>setState('clean')}/>};createRoot(document.getElementById('app')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    nodePaths: [root + 'apps/mobile/node_modules'],
  },
  [
    { path: 'react-native', contents: native },
    { path: './settings-controls', importer: mobile + 'screens/', contents: native },
    { path: '../ui/content/text', importer: mobile + 'screens/', contents: native },
    { path: '../ui/theme', importer: mobile + 'screens/', contents: native },
  ],
)
const server = await createServer({
  configFile: false,
  root,
  plugins: [tailwindcss()],
  server: { middlewareMode: true },
  logLevel: 'error',
})
let css
try {
  css = (await server.transformRequest('/packages/studio-ui/src/styles.css?direct')).code
} finally {
  await server.close()
}
const browser = await chromium.launch()
try {
  for (const nativeUI of [false, true])
    for (const [width, scale] of [
      [320, 1],
      [390, 1],
      [1024, 1],
      [390, 1.5],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setContent(
        '<html><body style="margin:0;font-family:system-ui"><div id="app"></div></body></html>',
      )
      await page.addStyleTag({
        content: css + `html{font-size:${16 * scale}px}body{font-size:${13 * scale}px}`,
      })
      await page.addScriptTag({ content: (nativeUI ? mobileBundle : desktop).outputFiles[0].text })
      const footer = page.getByLabel('Settings save actions', { exact: true })
      const save = page.getByRole('button', { name: 'Save changes', exact: true })
      const discard = page.getByRole('button', { name: 'Discard', exact: true })
      await save.waitFor()
      const before = {
        footer: await footer.boundingBox(),
        save: await save.boundingBox(),
        discard: await discard.boundingBox(),
      }
      for (const state of ['dirty', 'saving', 'saved', 'clean']) {
        await page.evaluate((state) => window.setSaveState(state), state)
        await page.waitForFunction(
          ({ nativeUI, state }) => {
            const footer = document.querySelector('[aria-label="Settings save actions"]')
            return (
              footer.getAttribute('aria-busy') === String(state === 'saving') &&
              footer.textContent.includes(
                state === 'dirty'
                  ? '1 unsaved change'
                  : state === 'saving'
                    ? 'Saving…'
                    : state === 'saved'
                      ? 'Changes saved.'
                      : nativeUI
                        ? 'No unsaved changes'
                        : 'No unsaved changes',
              )
            )
          },
          { nativeUI, state },
        )
        assert.deepEqual(
          {
            footer: await footer.boundingBox(),
            save: await save.boundingBox(),
            discard: await discard.boundingBox(),
          },
          before,
          `Save actions stay in place: ${nativeUI ? 'mobile' : 'desktop'} ${width}px ${state}`,
        )
      }
      if (!nativeUI) {
        const end = page.locator('[data-content-end]')
        const widthBefore = await end.evaluate((node) => node.getBoundingClientRect().width)
        await page.evaluate(() => window.setLong(true))
        await page.waitForFunction(
          () => document.querySelector('[aria-label="Scrollable settings"]').scrollHeight > 1200,
        )
        assert.equal(
          await end.evaluate((node) => node.getBoundingClientRect().width),
          widthBefore,
          'Scrollbar appearance preserves content width',
        )
        for (const webDialog of [false, true]) {
          await page.emulateMedia({ reducedMotion: 'no-preference' })
          await page.evaluate((webDialog) => {
            document.documentElement.dataset.motion = 'system'
            window.setWebDialog(webDialog)
          }, webDialog)
          await page.getByRole('button', { name: 'Open dialog', exact: true }).click()
          const dialog = page.getByRole('dialog')
          await dialog.waitFor()
          const animation = await dialog.evaluate((node) => ({
            names: node.getAnimations().map((animation) => animation.animationName),
            transform: getComputedStyle(node).transform,
            translate: getComputedStyle(node).translate,
            rect: node.getBoundingClientRect().toJSON(),
            frames: node.getAnimations().flatMap((animation) => animation.effect.getKeyframes()),
          }))
          assert.deepEqual(
            animation.names,
            ['dovo-dialog-enter'],
            'The shared fade is present in generated CSS',
          )
          assert.equal(
            animation.frames.some((frame) => frame.transform || frame.translate || frame.scale),
            false,
            'Opening a dialog only fades; its controls do not move',
          )
          await page.waitForFunction(() =>
            document
              .querySelector('[role="dialog"]')
              .getAnimations()
              .every((animation) => animation.playState === 'finished'),
          )
          const settled = await dialog.boundingBox()
          for (const key of ['x', 'y', 'width', 'height'])
            assert.ok(
              Math.abs(animation.rect[key] - settled[key]) < 1,
              `Dialog ${key} remains fixed during opening`,
            )
          await page.getByRole('button', { name: 'Close', exact: true }).click()
          await dialog.waitFor({ state: 'detached' })
          for (const reducedBy of ['system', 'setting']) {
            await page.emulateMedia({
              reducedMotion: reducedBy === 'system' ? 'reduce' : 'no-preference',
            })
            await page.evaluate(
              (reducedBy) =>
                (document.documentElement.dataset.motion =
                  reducedBy === 'setting' ? 'reduce' : 'system'),
              reducedBy,
            )
            await page.getByRole('button', { name: 'Open dialog', exact: true }).click()
            await dialog.waitFor()
            assert.equal(
              await dialog.evaluate((node) => node.getAnimations().length),
              0,
              `Reduced motion via ${reducedBy} skips dialog animation`,
            )
            await page.getByRole('button', { name: 'Close', exact: true }).click()
            await dialog.waitFor({ state: 'detached' })
          }
        }
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  console.log(
    'Layout stability: desktop/mobile save states preserve action geometry; scrollbars preserve content width; dialogs fade without moving controls at phone/tablet/desktop widths and larger text.',
  )
} finally {
  await browser.close()
}
