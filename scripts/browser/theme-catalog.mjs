import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const require = createRequire(new URL('../../packages/studio-core/package.json', import.meta.url))
const { zipSync, strToU8 } = require('fflate')

export async function installThemeCatalogRoutes(page) {
  const extension = {
    namespace: 'example',
    name: 'aurora',
    version: '1.2.3',
    displayName: 'Aurora',
    description: 'A balanced code palette for editors and diffs.',
    downloadCount: 24000,
  }
  const second = { ...extension, name: 'quiet', displayName: 'Quiet' }
  const base = 'https://open-vsx.org/api/example/aurora/1.2.3'
  const bytes = zipSync({
    'extension/package.json': strToU8(
      JSON.stringify({
        contributes: {
          themes: [
            { label: 'Aurora Dark', path: './dark.json', uiTheme: 'vs-dark' },
            { label: 'Aurora Light', path: './light.json', uiTheme: 'vs' },
          ],
        },
      }),
    ),
    'extension/base.json': strToU8(
      JSON.stringify({
        tokenColors: [
          { scope: 'comment', settings: { foreground: '#8392a5' } },
          { scope: 'keyword', settings: { foreground: '#bb9af7' } },
          { scope: 'string', settings: { foreground: '#9ece6a' } },
          { scope: 'entity.name.function', settings: { foreground: '#7dcfff' } },
        ],
      }),
    ),
    'extension/dark.json': strToU8(
      JSON.stringify({
        include: './base.json',
        colors: { 'editor.background': '#18202d', 'editor.foreground': '#d8e0ee' },
      }),
    ),
    'extension/light.json': strToU8(
      JSON.stringify({
        include: './base.json',
        colors: { 'editor.background': '#f4f6fb', 'editor.foreground': '#263448' },
      }),
    ),
  })
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const state = { requests: [], failedSearch: false, failedDownload: false }
  await page.route('https://open-vsx.org/**', async (route) => {
    const url = new URL(route.request().url())
    state.requests.push(url.toString())
    const headers = { 'access-control-allow-origin': '*' }
    const json = (value) =>
      route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname === '/api/-/search') {
      const query = url.searchParams.get('query'),
        offset = Number(url.searchParams.get('offset'))
      assert.equal(url.searchParams.get('category'), 'Themes')
      if (query === 'offline' && !state.failedSearch) {
        state.failedSearch = true
        return route.fulfill({ headers, status: 503, body: '' })
      }
      if (query === 'old') {
        await new Promise((resolve) => setTimeout(resolve, 750))
        return json({
          extensions: [{ ...extension, displayName: 'Obsolete result' }],
          totalSize: 1,
          offset: 0,
        })
      }
      return json({
        extensions: query === 'nothing' ? [] : [offset ? second : extension],
        totalSize: query ? (query === 'nothing' ? 0 : 1) : 21,
        offset,
      })
    }
    if (url.toString() === base)
      return json({
        ...extension,
        license: 'MIT',
        files: { download: base + '/file/aurora.vsix', sha256: base + '/file/aurora.sha256' },
      })
    if (url.pathname.endsWith('.sha256')) {
      const body = state.failedDownload ? checksum : 'wrong-checksum'
      state.failedDownload = true
      return route.fulfill({ headers, contentType: 'text/plain', body })
    }
    if (url.pathname.endsWith('.vsix'))
      return route.fulfill({
        headers,
        contentType: 'application/octet-stream',
        body: Buffer.from(bytes),
      })
    throw new Error('Unexpected catalog request: ' + url)
  })
  return state
}

export async function exerciseThemeBrowser(page, state, { mobile = false } = {}) {
  assert.equal(state.requests.length, 0, 'Appearance does not fetch the registry until browsing')
  await page.getByRole('button', { name: 'Browse VS Code themes', exact: true }).click()
  const browser = page.getByRole('dialog', { name: 'Browse VS Code themes', exact: true })
  const search = browser.getByLabel('Search VS Code themes', { exact: true })
  await browser.getByRole('button', { name: /^Aurora/ }).waitFor()
  await browser.getByRole('button', { name: 'Load more themes', exact: true }).click()
  await browser.getByRole('button', { name: /^Quiet/ }).waitFor()
  assert.equal(await browser.getByRole('button', { name: /^Aurora/ }).count(), 1)
  await search.fill('nothing')
  await browser.getByText(/No code themes found/).waitFor()
  await search.fill('offline')
  await browser.getByRole('button', { name: 'Retry search', exact: true }).click()
  await browser.getByRole('button', { name: /^Aurora/ }).waitFor()
  await search.fill('old')
  await page.waitForFunction(() => window.catalogRequests?.includes('old'))
  await search.fill('aurora')
  await browser.getByRole('button', { name: /^Aurora/ }).waitFor()
  await page.waitForTimeout(900)
  assert.equal(await browser.getByText('Obsolete result', { exact: true }).count(), 0)
  if (process.env.DOVO_CATALOG_SCREENSHOT)
    await page.screenshot({
      path: process.env.DOVO_CATALOG_SCREENSHOT.replace('.png', '-search.png'),
    })
  await browser.getByRole('button', { name: /^Aurora/ }).click()
  await browser.getByRole('button', { name: 'Retry download', exact: true }).click()
  await browser.getByRole('button', { name: 'Import Aurora Dark', exact: true }).waitFor()
  await browser.getByRole('button', { name: 'Import Aurora Light', exact: true }).waitFor()
  assert.ok((await browser.textContent()).includes('MIT'))
  if (process.env.DOVO_CATALOG_SCREENSHOT)
    await page.screenshot({ path: process.env.DOVO_CATALOG_SCREENSHOT })
  if (!mobile) {
    const viewport = page.viewportSize()
    await page.setViewportSize({ width: 390, height: 844 })
    const box = await browser.boundingBox()
    assert.ok(
      box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845,
      'Theme browser fits compact screens',
    )
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    )
    if (process.env.DOVO_CATALOG_SCREENSHOT)
      await page.screenshot({
        path: process.env.DOVO_CATALOG_SCREENSHOT.replace('.png', '-compact.png'),
      })
    await page.setViewportSize(viewport)
  }
  const before = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).codeTheme,
    mobile ? 'dovo.mobile-preferences.v1' : 'dovo.app-preferences.v1',
  )
  await browser.getByRole('button', { name: 'Close', exact: true }).click()
  await browser.waitFor({ state: 'detached' })
  assert.equal(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).codeTheme,
      mobile ? 'dovo.mobile-preferences.v1' : 'dovo.app-preferences.v1',
    ),
    before,
  )
  await page.getByRole('button', { name: 'Browse VS Code themes', exact: true }).click()
  await browser.getByRole('button', { name: /^Aurora/ }).click()
  await browser.getByRole('button', { name: 'Import Aurora Dark', exact: true }).waitFor()
  await browser.getByRole('button', { name: 'Back to themes', exact: true }).click()
  await browser.getByRole('button', { name: /^Aurora/ }).click()
  await browser.getByRole('button', { name: 'Import Aurora Dark', exact: true }).click()
  await browser.waitFor({ state: 'detached' })
  const key = mobile ? 'dovo.mobile-preferences.v1' : 'dovo.app-preferences.v1'
  await page.waitForFunction(
    (key) =>
      JSON.parse(localStorage.getItem(key)).importedCodeThemes.some(
        (theme) => theme.label === 'Aurora Dark',
      ),
    key,
  )
  const preferences = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)
  const imported = preferences.importedCodeThemes.find((theme) => theme.label === 'Aurora Dark')
  assert.equal(preferences.codeTheme, imported.name)
  assert.equal(imported.source.registry, 'open-vsx')
  assert.equal(imported.source.version, '1.2.3')
  assert.equal(imported.bg, '#18202d')
  assert.equal(imported.tokenColors.length, 4)
}
