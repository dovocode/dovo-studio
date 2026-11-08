import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFile, readdir } from 'node:fs/promises'
import { bundleBrowser, chromium } from './browser/harness.mjs'
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const listMarkdown = `### Plain lists
- Plain item wraps across several lines so its continuation must align with the first word, keeping the bullet outside the text.
  - Nested item wraps across several lines while retaining its own indentation and its own hanging bullet marker.

### Ordered lists
9. Numbered item wraps across several lines so its continuation must align with the first word rather than the number.
10. Another numbered item keeps two-digit markers outside the text and preserves the list's starting number.

### Checklists
- [x] Completed item wraps across several lines so its text continues after the checkbox without moving underneath it.
- [ ] Unchecked item wraps across several lines so its text continues after the checkbox without moving underneath it.

### Loose lists
- Loose item wraps across several lines so its continuation must align with the first word even when it contains paragraphs.

  A second paragraph stays within the same item.
`
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
const render=()=>app.render(<><MessageResponse>{'\`\`\`typescript\\n'+text+'\\n\`\`\`'}</MessageResponse><section id="lists" style={{width:270}}><MessageResponse>{${JSON.stringify(listMarkdown)}}</MessageResponse></section></>);
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
  const stylesheet = process.env.DOVO_BROWSER_STYLE_PATH
    ? await readFile(process.env.DOVO_BROWSER_STYLE_PATH, 'utf8')
    : (
        await Promise.all(
          (await readdir(root + '/apps/web/dist/client/assets'))
            .filter((name) => name.endsWith('.css'))
            .map((name) => readFile(root + '/apps/web/dist/client/assets/' + name, 'utf8')),
        )
      ).join('\n')
  await page.addStyleTag({ content: stylesheet })
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
    const lists = await page.locator('#lists').evaluate((container) => {
      const items = [...container.querySelectorAll('li')].map((item) => {
        const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) =>
            node.parentElement.closest('li') === item
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT,
        })
        const lines = new Map()
        let node
        while ((node = walker.nextNode())) {
          for (const match of node.textContent.matchAll(/\S+/g)) {
            const range = document.createRange()
            range.setStart(node, match.index)
            range.setEnd(node, match.index + match[0].length)
            for (const rect of range.getClientRects()) {
              const top = Math.round(rect.top)
              lines.set(top, Math.min(lines.get(top) ?? Infinity, rect.left))
            }
          }
        }
        const checkbox = item.querySelector(':scope > input, :scope > p > input')
        return {
          text: item.textContent.trim(),
          left: item.getBoundingClientRect().left,
          lines: [...lines.values()],
          checkboxRight: checkbox?.getBoundingClientRect().right,
          listStyleType: getComputedStyle(item.parentElement).listStyleType,
        }
      })
      return { items, start: container.querySelector('ol')?.start }
    })
    assert.equal(lists.start, 9, 'Ordered lists preserve their starting number')
    for (const item of lists.items) {
      assert.ok(item.lines.length > 1, `Fixture must wrap: ${item.text}`)
      for (const left of item.lines) {
        assert.ok(Math.abs(left - item.lines[0]) < 1, `Hanging text alignment: ${item.text}`)
      }
      if (item.checkboxRight !== undefined) {
        assert.equal(item.listStyleType, 'none', 'Checklists suppress bullet markers')
        assert.ok(item.lines[0] > item.checkboxRight, 'Checklist text clears the checkbox')
      }
    }
    assert.ok(lists.items[1].left > lists.items[0].left, 'Nested lists retain their indentation')
  }
  await page.evaluate(() => window.stream())
  await page.waitForFunction(() => document.querySelector('code')?.textContent.includes('next = 2'))
  assert.deepEqual(errors, [])
  console.log(
    'Pierre chat highlighting preserves text and font styles; Markdown lists retain hanging indents, nesting, ordered starts and checkboxes in both themes.',
  )
} finally {
  await browser.close()
}
