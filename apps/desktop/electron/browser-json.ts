import viewerScript from './generated/browser-json-viewer.json'
import { nativeTheme, type WebContents } from 'electron'
import { decodeResult } from '@dovo/protocol'
import { readLocalSettingsSection } from '@dovo/protocol/local-settings'
import { formatBrowserJson, highlightBrowserJson } from '@dovo/studio-core/browser-json'
import {
  resolveCodeTheme,
  codeThemeSchema,
  importedCodeThemesSchema,
} from '@dovo/studio-core/code-themes'
import { studioThemeIds } from '@dovo/studio-core/themes'
import { Schema } from 'effect'
const preferencesSchema = Schema.Struct({
  theme: Schema.optional(Schema.Literals(['dark', 'light', 'system'])),
  themePalette: Schema.optional(Schema.Literals([...studioThemeIds])),
  codeTheme: Schema.optional(codeThemeSchema),
  importedCodeThemes: Schema.optional(importedCodeThemesSchema),
})

/** Format the committed response itself. Never refetch (POSTs and authenticated endpoints matter). */
export async function renderBrowserJson(contents: WebContents) {
  const frame = contents.mainFrame
  const source: unknown = await contents.executeJavaScriptInIsolatedWorld(1003, [
    {
      code: `(() => {
        if (!/^(application|text)\\/(?:[\\w.-]+\\+)?json$/i.test(document.contentType)) return;
        return document.querySelector('pre')?.textContent ?? document.body?.textContent;
      })()`,
    },
  ])
  if (typeof source !== 'string' || source.length > 5 * 1024 * 1024) return
  let formatted: string
  try {
    formatted = formatBrowserJson(source)
  } catch {
    // Invalid JSON remains the original response, including the server's diagnostics.
    return
  }
  const settings = decodeResult(preferencesSchema, readLocalSettingsSection('app'))
  const preferences = settings.success ? settings.data : undefined
  const mode =
    preferences?.theme === 'light' ||
    (preferences?.theme !== 'dark' && !nativeTheme.shouldUseDarkColors)
      ? 'light'
      : 'dark'
  const theme = resolveCodeTheme(
    preferences?.codeTheme ?? 'app',
    preferences?.importedCodeThemes ?? [],
    preferences?.themePalette ?? 'dovo',
    mode,
  )
  const { html, css } = highlightBrowserJson(formatted, theme)
  if (contents.isDestroyed() || frame.detached || contents.mainFrame !== frame) return
  await contents.insertCSS(
    `html[data-dovo-json]{color-scheme:${mode};background:${mode === 'dark' ? '#141416' : '#ffffff'};color:${mode === 'dark' ? '#e4e4e7' : '#202024'}}
     html[data-dovo-json] body{margin:0}
     html[data-dovo-json] header{position:sticky;top:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 20px;background:${mode === 'dark' ? '#1c1c1f' : '#f4f4f5'};border-bottom:1px solid ${mode === 'dark' ? '#ffffff20' : '#00000020'};font:13px system-ui;z-index:1}
     html[data-dovo-json] header strong{margin-right:8px}
     html[data-dovo-json] form{display:flex;flex:1;gap:8px;min-width:min(100%,22rem);margin:0}
     html[data-dovo-json] input{flex:1;min-width:0;font:13px ui-monospace,SFMono-Regular,Consolas,monospace;color:inherit;background:transparent;border:1px solid ${mode === 'dark' ? '#ffffff30' : '#00000030'};border-radius:6px;padding:6px 10px}
     html[data-dovo-json] input:focus-visible{outline:2px solid #70b8ff;outline-offset:1px}
     html[data-dovo-json] [role=status]{flex-basis:100%;font-size:12px;opacity:.75;overflow-wrap:anywhere}
     html[data-dovo-json] [data-error]{color:${mode === 'dark' ? '#fca5a5' : '#b91c1c'}}
     html[data-dovo-json] button:disabled{opacity:.4;cursor:default}
     html[data-dovo-json] button{font:inherit;color:inherit;background:transparent;border:1px solid ${mode === 'dark' ? '#ffffff30' : '#00000030'};border-radius:6px;padding:5px 10px;cursor:pointer}
     html[data-dovo-json] pre{margin:0;padding:20px;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2;white-space:pre;overflow:auto}
     ${css}`,
    { cssOrigin: 'user' },
  )
  if (contents.isDestroyed() || frame.detached || contents.mainFrame !== frame) return
  await contents.executeJavaScriptInIsolatedWorld(1003, [
    {
      code: `${viewerScript}\nDovoJsonViewer.installJsonViewer(${JSON.stringify({ source, formatted, html })})`,
    },
  ])
}
