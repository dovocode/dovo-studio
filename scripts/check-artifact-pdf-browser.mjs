import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { chromium } from './browser/harness.mjs'
import { artifactPreviewHtml } from '../packages/protocol/dist/index.js'
import { startRuntime } from '../packages/runtime/dist/index.js'

const requireRuntime = createRequire(new URL('../packages/runtime/package.json', import.meta.url))
const { getDocument } = await import(requireRuntime.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
let networkRequests = 0
const canary = createServer((_request, response) => {
  networkRequests++
  response.end('External resource')
})
await new Promise((resolve) => canary.listen(0, '127.0.0.1', resolve))
const external = `http://127.0.0.1:${canary.address().port}`
const ownerToken = randomUUID()
const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
const taskId = randomUUID()
runtime.services.preferences.save({ enableArtifacts: true })
runtime.services.store.update((workspace) => ({
  ...workspace,
  tasks: [
    {
      id: taskId,
      title: 'PDF checks',
      repositoryId: '',
      agentId: '',
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: '',
      example: false,
    },
  ],
}))

async function exportPdf(id, revision, options, draftHtml) {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/artifacts/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, id, revision, options, draftHtml }),
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  assert.equal(result.mime, 'application/pdf')
  assert.ok(result.name.endsWith('.pdf'))
  const bytes = Uint8Array.from(Buffer.from(result.data, 'base64'))
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-')
  const loading = getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false })
  const pdf = await loading.promise
  try {
    const pages = []
    const dimensions = []
    const textItems = []
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      dimensions.push(page.view)
      textItems.push(content.items.filter((item) => 'str' in item))
      pages.push(
        content.items
          .filter((item) => 'str' in item)
          .map((item) => item.str + (item.hasEOL ? '\n' : ''))
          .join(''),
      )
    }
    return { text: pages.join('\n'), pages, dimensions, textItems }
  } finally {
    await loading.destroy()
  }
}

try {
  const saved = await runtime.services.artifacts.write({
    taskId,
    title: 'Long document',
    format: 'markdown',
    content:
      '# Earlier revision\n\n' +
      Array.from(
        { length: 180 },
        (_, index) =>
          `Paragraph ${index + 1}: **Formatted text**, with a [reference](https://example.com) and readable content.\n`,
      ).join('\n') +
      '\nFinalPageMarker',
  })
  await runtime.services.artifacts.write({
    ...saved,
    expectedRevision: 1,
    content: '# Current revision',
  })
  const older = await exportPdf(saved.id, 1)
  assert.ok(older.pages.length > 1, 'Long documents must paginate instead of clipping an iframe')
  assert.ok(older.text.includes('Earlier revision'))
  assert.ok(
    older.pages.at(-1).includes('FinalPageMarker'),
    'The end of a long document must be exported',
  )
  assert.ok(
    !older.text.includes('**Formatted text**'),
    'Markdown must render rather than export raw source',
  )
  const latest = await exportPdf(saved.id)
  assert.ok(latest.text.includes('Current revision'))
  assert.ok(!latest.text.includes('Earlier revision'))

  const html = await runtime.services.artifacts.write({
    taskId,
    title: 'Interactive HTML',
    format: 'html',
    content: `
    <style>@page{size:A4} .next{break-before:page} @media print{.screen-only{display:none}}</style>
    <h1>HTML print heading</h1><p class="screen-only">ScreenOnlyMarker</p><p id="isolation">Pending checks</p>
    <script>
      let isolated=false;try{localStorage.getItem('token')}catch{isolated=true}
      const popup=window.open('${external}/popup');
      document.querySelector('#isolation').textContent=isolated && !popup?'Isolation verified':'Isolation failed';
      fetch('${external}/fetch').catch(()=>{});
    </script>
    <img src="${external}/image"><iframe src="${external}/frame"></iframe>
    <p class="next">Second HTML page</p>`,
  })
  const renderedHtml = await exportPdf(html.id)
  assert.ok(renderedHtml.text.includes('HTML print heading'))
  assert.ok(
    renderedHtml.text.includes('Isolation verified'),
    'HTML must run inside an opaque sandbox: ' + renderedHtml.text,
  )
  assert.ok(renderedHtml.text.includes('Second HTML page'))
  assert.ok(!renderedHtml.text.includes('ScreenOnlyMarker'), 'Authored print styles must apply')
  assert.equal(renderedHtml.pages.length, 2)

  const pageOptions = await runtime.services.artifacts.write({
    taskId,
    title: 'Page options',
    format: 'html',
    content:
      '<style>@page{size:A5;margin:30mm}body{margin:0}p{margin:0;font-size:20px;background:rgb(0,128,0)}</style><p>PageOptionsMarker</p>',
  })
  const automatic = await exportPdf(pageOptions.id)
  assert.ok(
    Math.abs(automatic.dimensions[0][2] - 420) < 2,
    'Automatic must preserve authored A5 pages',
  )
  const landscape = await exportPdf(pageOptions.id, 1, {
    paperSize: 'Letter',
    landscape: true,
    marginMm: 0,
    scale: 100,
    background: true,
  })
  assert.ok(Math.abs(landscape.dimensions[0][2] - 792) < 1, 'US Letter landscape width')
  assert.ok(Math.abs(landscape.dimensions[0][3] - 612) < 1, 'US Letter landscape height')
  const zeroMargin = landscape.textItems[0].find((item) => item.str.includes('PageOptionsMarker'))
  assert.ok(
    Math.abs(zeroMargin.transform[4]) < 1,
    'Explicit margins must override authored @page margins',
  )
  const scaled = await exportPdf(pageOptions.id, 1, {
    paperSize: 'Letter',
    landscape: false,
    marginMm: 10,
    scale: 50,
    background: false,
  })
  assert.ok(Math.abs(scaled.dimensions[0][2] - 612) < 1, 'US Letter portrait width')
  const scaledText = scaled.textItems[0].find((item) => item.str.includes('PageOptionsMarker'))
  assert.ok(Math.abs(scaledText.transform[4] - 28.35) < 1, '10 mm margin must be applied')
  assert.ok(
    Math.abs(scaledText.transform[0] / zeroMargin.transform[0] - 0.5) < 0.01,
    '50% content scale must be applied',
  )

  const nonPrintable = await runtime.services.artifacts.write({
    taskId,
    title: 'Export exclusions',
    format: 'html',
    content: `<h1>VisibleExportMarker</h1><aside class="no-print">HiddenByClassMarker</aside><aside data-no-print>HiddenByAttributeMarker</aside><p id="rendered" onclick="alert('never')">Initial</p><canvas id="chart" width="8" height="8"></canvas><script>document.querySelector('#rendered').textContent='InitializedExportMarker';const chart=document.querySelector('#chart').getContext('2d');chart.fillStyle='blue';chart.fillRect(0,0,8,8)</script>`,
  })
  const cleanPdf = await exportPdf(nonPrintable.id)
  assert.ok(cleanPdf.text.includes('VisibleExportMarker'))
  assert.ok(cleanPdf.text.includes('InitializedExportMarker'))
  assert.ok(!cleanPdf.text.includes('HiddenByClassMarker'))
  assert.ok(!cleanPdf.text.includes('HiddenByAttributeMarker'))
  const previewResponse = await fetch(
    `http://127.0.0.1:${runtime.port}/api/artifacts/export-preview`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, id: nonPrintable.id, revision: 1 }),
    },
  )
  assert.equal(previewResponse.status, 200)
  const prepared = await previewResponse.json()
  assert.ok(
    prepared.content.includes('InitializedExportMarker'),
    'Editor must start with initialized guest content',
  )
  assert.ok(!prepared.content.includes('<canvas'), 'Editing must freeze rendered canvases')
  assert.ok(
    prepared.content.includes('data:image/png;base64,'),
    'Canvas drawings must remain visible in edited exports',
  )
  assert.ok(
    prepared.content.includes('HiddenByClassMarker'),
    'Non-printable elements must remain available for editing',
  )
  assert.ok(
    !/<script\b|onclick=/i.test(prepared.content),
    'Editor preparation must strip executable content',
  )
  const editedCopy =
    '<h1>TemporaryExportMarker</h1><section data-no-print>DraftExcludedMarker</section>'
  const editedPdf = await exportPdf(nonPrintable.id, 1, undefined, editedCopy)
  assert.ok(editedPdf.text.includes('TemporaryExportMarker'))
  assert.ok(!editedPdf.text.includes('VisibleExportMarker'))
  assert.ok(!editedPdf.text.includes('DraftExcludedMarker'))
  assert.ok(
    runtime.services.artifacts
      .read(taskId, nonPrintable.id)
      .content.includes('VisibleExportMarker'),
    'Export edits must never change the saved source',
  )
  assert.equal(runtime.services.artifacts.versions(taskId, nonPrintable.id).length, 1)
  for (const draftHtml of [undefined, editedCopy]) {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/artifacts/mhtml`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, id: nonPrintable.id, revision: 1, draftHtml }),
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    const mhtml = Buffer.from(result.data, 'base64')
      .toString()
      .replace(/=\r?\n/g, '')
    assert.ok(
      mhtml.includes(draftHtml === undefined ? 'VisibleExportMarker' : 'TemporaryExportMarker'),
    )
    assert.ok(!mhtml.includes('HiddenByClassMarker'))
    assert.ok(!mhtml.includes('HiddenByAttributeMarker'))
    assert.ok(!mhtml.includes('DraftExcludedMarker'))
  }

  const sharp = (await import(requireRuntime.resolve('sharp'))).default
  async function exportPng(id, width, revision) {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/artifacts/png`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, id, width, revision }),
    })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    assert.equal(result.mime, 'image/png')
    assert.ok(result.name.endsWith('.png'))
    return Buffer.from(result.data, 'base64')
  }
  const pngArtifact = await runtime.services.artifacts.write({
    taskId,
    title: 'Tall responsive page',
    format: 'html',
    content: `
    <style>body{margin:0;background:#fff}#top{height:100px;background:rgb(0,0,255)}#space{height:2000px}#bottom{height:100px;background:rgb(0,255,0)}@media(max-width:600px){#top{background:rgb(255,0,0)}}@media print{#top{display:none}}</style>
    <div id="top" class="no-print"></div><div id="space"></div><div id="bottom"></div><script>let isolated=false;try{localStorage.getItem('token')}catch{isolated=true}if(!isolated)document.querySelector('#bottom').style.background='black';fetch('${external}/png-fetch').catch(()=>{})</script><img src="${external}/png-image" style="display:none">`,
  })
  for (const width of [320, 960, 4096, undefined]) {
    const image = await exportPng(pngArtifact.id, width, 1)
    const metadata = await sharp(image).metadata()
    assert.equal(metadata.width, width ?? 1440, 'PNG must have exactly the requested width')
    assert.equal(metadata.height, 2200, 'PNG must capture the entire document past the viewport')
    const sample = async (y) =>
      Array.from(
        await sharp(image)
          .extract({ left: 10, top: y, width: 1, height: 1 })
          .removeAlpha()
          .raw()
          .toBuffer(),
      )
    assert.deepEqual(
      await sample(50),
      width === 320 ? [255, 0, 0] : [0, 0, 255],
      'PNG must use responsive screen styles',
    )
    assert.deepEqual(
      await sample(2150),
      [0, 255, 0],
      'Bottom content and sandbox isolation must survive',
    )
  }
  await runtime.services.artifacts.write({
    ...runtime.services.artifacts.read(taskId, pngArtifact.id),
    expectedRevision: 1,
    content: '<style>body{margin:0;background:red;height:900px}</style>',
  })
  const previous = await sharp(await exportPng(pngArtifact.id, 960, 1)).metadata()
  const current = await sharp(await exportPng(pngArtifact.id, 960)).metadata()
  assert.equal(previous.height, 2200, 'PNG must honor saved revisions')
  assert.equal(current.height, 900, 'PNG must use latest when no revision is supplied')
  const huge = await runtime.services.artifacts.write({
    taskId,
    title: 'Too tall',
    format: 'html',
    content: '<div style="height:40000px"></div>',
  })
  const tooTall = await fetch(`http://127.0.0.1:${runtime.port}/api/artifacts/png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, id: huge.id, width: 960 }),
  })
  assert.equal(tooTall.status, 400, 'Oversized PNGs must fail clearly, never silently crop')
  await exportPng(pngArtifact.id, 960, 1) // Failed captures must release the shared render queue.

  const folder = await runtime.services.artifacts.write({
    taskId,
    title: 'Folder preview',
    format: 'html',
    entrypoint: 'pages/index.html',
    files: [
      {
        path: 'pages/index.html',
        content: `<!doctype html><html><head><link rel="stylesheet" href="../styles/main.css"><script defer src="../scripts/setup.js"></script></head><body><h1>Folder PDF marker</h1><button id="folder-count">0</button><button id="module">Pending</button><button id="global" onclick="increment()">0</button><img id="asset" src="../assets/logo.svg" srcset="../assets/logo.svg 1x, ../assets/logo.svg 2x"><div id="inline" style="background-image:url(../assets/logo.svg)">Inline asset</div><svg><use href="../assets/logo.svg#logo"></use></svg><script type="module" src="../scripts/main.js"></script></body></html>`,
      },
      {
        path: 'styles/main.css',
        content:
          '@import "./colors.css"; #folder-count { color: rgb(10, 20, 30); background-image:url(../assets/logo.svg) }',
      },
      { path: 'styles/colors.css', content: 'body { --folder-color: blue }' },
      {
        path: 'scripts/setup.js',
        content: `document.querySelector('#folder-count').onclick=event=>event.target.textContent=Number(event.target.textContent)+1;document.querySelector('#folder-count').dataset.ready='yes';let globalCount=0;function increment(){document.querySelector('#global').textContent=++globalCount}`,
      },
      {
        path: 'scripts/main.js',
        content: `import {label} from './label.js';import '../styles/module.css';document.querySelector('#module').textContent=label;let isolated=false;try{parent.parent.document.body.dataset.leaked='yes'}catch{isolated=true}document.body.dataset.isolated=String(isolated);let storageIsolated=false;try{localStorage.getItem('token')}catch{storageIsolated=true}document.body.dataset.storageIsolated=String(storageIsolated);fetch('${external}/folder-fetch').catch(()=>{});`,
      },
      { path: 'scripts/label.js', content: 'export const label="Module ready </script>";' },
      {
        path: 'styles/module.css',
        content: '#module { font-weight: 900 } #module::after {content:"</style>"}',
      },
      {
        path: 'assets/logo.svg',
        content:
          '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect id="logo" width="8" height="8" fill="blue"/></svg>',
      },
    ],
  })
  const directory = await mkdtemp(join(tmpdir(), 'dovo-folder-exports-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(
      artifactPreviewHtml(runtime.services.artifacts.read(taskId, folder.id).content),
    )
    const preview = page.frameLocator('iframe')
    await preview.locator('#folder-count[data-ready="yes"]').waitFor()
    await preview.locator('#module').filter({ hasText: 'Module ready </script>' }).waitFor()
    await preview.locator('#folder-count').click()
    assert.equal(await preview.locator('#folder-count').textContent(), '1')
    await preview.locator('#global').click()
    assert.equal(await preview.locator('#global').textContent(), '1')
    assert.equal(
      await preview.locator('#folder-count').evaluate((el) => getComputedStyle(el).color),
      'rgb(10, 20, 30)',
    )
    assert.equal(
      await preview.locator('#module').evaluate((el) => getComputedStyle(el).fontWeight),
      '900',
    )
    assert.equal(
      await preview.locator('#module').evaluate((el) => getComputedStyle(el, '::after').content),
      '"</style>"',
    )
    assert.equal(
      await preview.locator('#asset').evaluate(async (el) => {
        await el.decode()
        return el.naturalWidth > 0
      }),
      true,
    )
    assert.ok(
      (
        await preview.locator('#inline').evaluate((el) => getComputedStyle(el).backgroundImage)
      ).includes('data:image/svg+xml'),
    )
    assert.ok((await preview.locator('use').getAttribute('href')).endsWith('#logo'))
    assert.equal(await preview.locator('body').getAttribute('data-isolated'), 'true')
    assert.equal(await page.locator('body').getAttribute('data-leaked'), null)
    const offline = await browser.newContext({ offline: true, serviceWorkers: 'block' })
    for (const format of ['html', 'mhtml']) {
      const response = await fetch(`http://127.0.0.1:${runtime.port}/api/artifacts/${format}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, id: folder.id, revision: 1 }),
      })
      const result = await response.json()
      assert.equal(response.status, 200, JSON.stringify(result))
      assert.equal(result.name, `Folder preview.${format}`)
      const bytes = Buffer.from(result.data, 'base64')
      if (format === 'mhtml') {
        assert.ok(bytes.toString().includes('MIME-Version: 1.0'))
        assert.ok(bytes.toString().includes('multipart/related'))
      }
      const path = join(directory, result.name)
      await writeFile(path, bytes)
      const reopened = await offline.newPage()
      await reopened.goto(pathToFileURL(path).href)
      const guest = format === 'html' ? reopened.frameLocator('iframe') : reopened
      await guest.locator('#module').filter({ hasText: 'Module ready </script>' }).waitFor()
      assert.equal(
        await guest.locator('#folder-count').textContent(),
        '0',
        'Exports start from the saved preview',
      )
      await guest.locator('#folder-count').click()
      assert.equal(
        await guest.locator('#folder-count').textContent(),
        format === 'html' ? '1' : '0',
      )
      assert.equal(
        await guest.locator('#folder-count').evaluate((el) => getComputedStyle(el).color),
        'rgb(10, 20, 30)',
      )
      assert.equal(
        await guest.locator('#asset').evaluate(async (el) => {
          await el.decode()
          return el.naturalWidth > 0
        }),
        true,
      )
      assert.equal(await guest.locator('body').getAttribute('data-storage-isolated'), 'true')
      if (format === 'mhtml') assert.equal(await reopened.locator('script').count(), 0)
      await reopened.close()
    }
    await offline.close()
  } finally {
    await browser.close()
    await rm(directory, { recursive: true, force: true })
  }
  assert.ok((await exportPdf(folder.id)).text.includes('Folder PDF marker'))

  const svg = await runtime.services.artifacts.write({
    taskId,
    title: 'Vector graphic',
    format: 'svg',
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100"><text x="10" y="50" font-size="24">Vector PDF marker</text></svg>',
  })
  assert.ok((await exportPdf(svg.id)).text.includes('Vector PDF marker'))
  const code = await runtime.services.artifacts.write({
    taskId,
    title: 'Source code',
    format: 'code',
    language: 'html',
    content:
      '<script>document.body.textContent="MUST NOT EXECUTE"</script>\nconst CodeMarker = true;',
  })
  const renderedCode = await exportPdf(code.id)
  assert.ok(renderedCode.text.includes('CodeMarker'))
  assert.ok(renderedCode.text.includes('<script>'), 'Code must be escaped, never executed')
  assert.equal(networkRequests, 0, 'Artifact exports must not contact external resources')
  console.log(
    'Actual PDF/PNG exports passed: paper sizing, margins, scaling, exact image widths and full height, temporary edits and non-printable exclusions, all four formats, multi-file live previews and assets, offline interactive HTML/MHTML exports, pagination, saved revisions, selectable text, print styles, opaque sandbox and blocked external access.',
  )
} finally {
  await runtime.close()
  await new Promise((resolve) => canary.close(resolve))
}
