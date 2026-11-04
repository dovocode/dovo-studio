import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareWorkspaceRouterModel } from './workspace-router-model.mjs'

const bytes = Buffer.from('pinned test model bytes')
const model = {
  name: 'test-model',
  repository: 'example/model',
  revision: 'pinned-revision',
  files: [
    {
      name: 'model.onnx',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ],
}
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-router-model-'))
  const fetch = globalThis.fetch
  try {
    await run(directory)
  } finally {
    globalThis.fetch = fetch
    await rm(directory, { recursive: true, force: true })
  }
}
await test('downloads pinned assets once, verifies the cache, and bundles attribution', async () => {
  await fixture(async (directory) => {
    let requests = 0
    globalThis.fetch = async (url) => {
      requests++
      assert.equal(url, 'https://huggingface.co/example/model/resolve/pinned-revision/model.onnx')
      return new Response(bytes)
    }
    await prepareWorkspaceRouterModel(directory, model)
    await prepareWorkspaceRouterModel(directory, model)
    assert.equal(requests, 1)
    assert.deepEqual(await readFile(join(directory, 'model.onnx')), bytes)
    assert.match(await readFile(join(directory, 'LICENSE'), 'utf8'), /Apache License/)
    assert.match(await readFile(join(directory, 'NOTICE.md'), 'utf8'), /pinned-revision/)
    assert.equal(
      (await readFile(join(directory, 'NOTICE.md'), 'utf8')).split('\n')[0],
      'Bundled routing model: test-model',
    )
  })
})
await test('replaces corrupt cached assets only after verifying their replacement', async () => {
  await fixture(async (directory) => {
    const cached = Buffer.from('x'.repeat(bytes.length))
    await writeFile(join(directory, 'model.onnx'), cached)
    globalThis.fetch = async () => new Response(cached)
    await assert.rejects(prepareWorkspaceRouterModel(directory, model), /checksum mismatch/)
    assert.deepEqual(await readFile(join(directory, 'model.onnx')), cached)
    assert.deepEqual(await readdir(directory), ['model.onnx'])
    globalThis.fetch = async () => new Response(bytes)
    await prepareWorkspaceRouterModel(directory, model)
    assert.deepEqual(await readFile(join(directory, 'model.onnx')), bytes)
  })
})
await test('fails packaging on HTTP or checksum errors and removes partial downloads', async () => {
  for (const response of [() => new Response(null, { status: 404 }), () => new Response('bad')]) {
    await fixture(async (directory) => {
      globalThis.fetch = async () => response()
      await assert.rejects(
        prepareWorkspaceRouterModel(directory, model),
        /HTTP 404|checksum mismatch/,
      )
      assert.deepEqual(await readdir(directory), [])
    })
  }
})
