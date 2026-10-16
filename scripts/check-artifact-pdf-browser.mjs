import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
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

async function exportPdf(id, revision) {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/artifacts/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, id, revision }),
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
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .filter((item) => 'str' in item)
          .map((item) => item.str + (item.hasEOL ? '\n' : ''))
          .join(''),
      )
    }
    return { text: pages.join('\n'), pages }
  } finally {
    await loading.destroy()
  }
}

try {
  const saved = runtime.services.artifacts.write({
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
  runtime.services.artifacts.write({ ...saved, expectedRevision: 1, content: '# Current revision' })
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

  const html = runtime.services.artifacts.write({
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

  const svg = runtime.services.artifacts.write({
    taskId,
    title: 'Vector graphic',
    format: 'svg',
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100"><text x="10" y="50" font-size="24">Vector PDF marker</text></svg>',
  })
  assert.ok((await exportPdf(svg.id)).text.includes('Vector PDF marker'))
  const code = runtime.services.artifacts.write({
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
    'Actual PDF export passed: all four formats, pagination, saved revisions, selectable text, print styles, opaque sandbox and blocked external access.',
  )
} finally {
  await runtime.close()
  await new Promise((resolve) => canary.close(resolve))
}
