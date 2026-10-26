import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const bundle = await bundleBrowser(
  {
    stdin: {
      resolveDir: root + '/packages/studio-ui',
      loader: 'tsx',
      contents: `
import { createRoot } from 'react-dom/client';
import { MessageResponse } from '${root}/packages/studio-ui/src/components/ai-elements/message.tsx';
import { importCodeTheme } from '${root}/packages/studio-core/src/code-themes.ts';
import { updateAppPreferences } from '${root}/packages/studio-core/src/preferences.ts';
const app=createRoot(document.getElementById('app'));
let text='export const value = "😀";\\n\\n\\t// preserved';
const render=()=>app.render(<MessageResponse>{'\`\`\`typescript\\n'+text+'\\n\`\`\`'}</MessageResponse>);
window.stream=()=>{text+='\\nexport const next = 2;';render()};
window.importTheme=()=>{const theme=importCodeTheme(JSON.stringify({colors:{'editor.background':'#111111','editor.foreground':'#eeeeee'},tokenColors:[{scope:'keyword',settings:{foreground:'#cc3366',fontStyle:'italic bold'}}]}),'proof.json');updateAppPreferences({importedCodeThemes:[theme],codeTheme:theme.name})};
render();`,
    },
    jsx: 'automatic',
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    alias: {
      react: root + '/packages/studio-ui/node_modules/react',
      'react-dom': root + '/packages/studio-ui/node_modules/react-dom',
    },
  },
  [
    {
      path: '@dovo/studio-core',
      contents: `export * from '${root}/packages/studio-core/src/preferences.ts';`,
    },
  ],
)
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('http://code.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
  )
  await page.goto('http://code.test/')
  await page.addStyleTag({
    content: await readFile(root + '/packages/web-ui/src/markdown.css', 'utf8'),
  })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction(() => document.querySelector('code span[style]'))
  await page.evaluate(() => window.importTheme())
  await page.waitForFunction(() =>
    [...document.querySelectorAll('code span')].some(
      (span) =>
        span.textContent.includes('export') &&
        span.style.getPropertyValue('--shiki-dark') === '#cc3366' &&
        span.style.getPropertyValue('--shiki-dark-font-style') === 'italic' &&
        span.style.getPropertyValue('--shiki-dark-font-weight') === '700',
    ),
  )
  assert.equal(
    await page
      .locator('code > span')
      .evaluateAll((lines) =>
        lines.map((line) => (line.textContent === '\n' ? '' : line.textContent)).join('\n'),
      ),
    'export const value = "😀";\n\n\t// preserved',
  )
  for (const dark of [false, true]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark)
    const keyword = page.locator('code > span > span').filter({ hasText: 'export' }).first()
    assert.equal(await keyword.evaluate((span) => getComputedStyle(span).fontStyle), 'italic')
    assert.equal(await keyword.evaluate((span) => getComputedStyle(span).fontWeight), '700')
  }
  await page.evaluate(() => window.stream())
  await page.waitForFunction(() => document.querySelector('code')?.textContent.includes('next = 2'))
  assert.deepEqual(errors, [])
  console.log(
    'Pierre chat highlighting preserves text, streams updates and applies imported colors and font styles.',
  )
} finally {
  await browser.close()
}
