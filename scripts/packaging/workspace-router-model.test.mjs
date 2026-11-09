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
  baseUrl: 'https://example.com/pinned-revision',
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
await test('downloads pinned assets once and verifies the cache', async () => {
  await fixture(async (directory) => {
    let requests = 0
    globalThis.fetch = async (url) => {
      requests++
      assert.equal(url, 'https://example.com/pinned-revision/model.onnx')
      return new Response(bytes)
    }
    await prepareWorkspaceRouterModel(directory, model)
    await prepareWorkspaceRouterModel(directory, model)
    assert.equal(requests, 1)
    assert.deepEqual(await readFile(join(directory, 'model.onnx')), bytes)
    assert.deepEqual(await readdir(directory), ['model.onnx'])
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
      let requests = 0
      globalThis.fetch = async () => {
        requests++
        return response()
      }
      await assert.rejects(
        prepareWorkspaceRouterModel(directory, model),
        /HTTP 404|checksum mismatch/,
      )
      assert.equal(requests, 1)
      assert.deepEqual(await readdir(directory), [])
    })
  }
})
await test('recovers from temporary gateway errors before verifying the download', async () => {
  await fixture(async (directory) => {
    const requests = []
    const bodies = []
    globalThis.fetch = async (url) => {
      requests.push(url)
      if (requests.length === 3) return new Response(bytes)
      const response = new Response('temporarily unavailable', {
        status: requests.length === 1 ? 504 : 503,
      })
      bodies.push(response.body)
      return response
    }
    await prepareWorkspaceRouterModel(directory, model)
    assert.deepEqual(requests, [
      'https://example.com/pinned-revision/model.onnx',
      'https://example.com/pinned-revision/model.onnx',
      'https://example.com/pinned-revision/model.onnx',
    ])
    assert.deepEqual(await readFile(join(directory, 'model.onnx')), bytes)
    for (const body of bodies) assert.equal((await body.getReader().read()).done, true)
  })
})
await test('uses the public GitHub asset API after a download gateway error', async () => {
  await fixture(async (directory) => {
    const descriptor = {
      ...model,
      baseUrl: 'https://github.com/team/models/releases/download/pinned-revision',
    }
    const requests = []
    globalThis.fetch = async (url, options) => {
      requests.push(url)
      if (url === descriptor.baseUrl + '/model.onnx') return new Response(null, { status: 504 })
      if (url === 'https://api.github.com/repos/team/models/releases/tags/pinned-revision')
        return Response.json({
          assets: [{ id: 42, name: 'model.onnx', url: 'https://untrusted.test' }],
        })
      assert.equal(url, 'https://api.github.com/repos/team/models/releases/assets/42')
      assert.equal(options.headers.Accept, 'application/octet-stream')
      return new Response(bytes)
    }
    await prepareWorkspaceRouterModel(directory, descriptor)
    assert.equal(requests.length, 3)
    assert.deepEqual(await readFile(join(directory, 'model.onnx')), bytes)
  })
})
await test('still rejects corrupt data from the GitHub asset fallback', async () => {
  await fixture(async (directory) => {
    const descriptor = {
      ...model,
      baseUrl: 'https://github.com/team/models/releases/download/pinned-revision',
    }
    globalThis.fetch = async (url) => {
      if (url === descriptor.baseUrl + '/model.onnx') return new Response(null, { status: 503 })
      if (url.endsWith('/tags/pinned-revision'))
        return Response.json({ assets: [{ id: 42, name: 'model.onnx' }] })
      return new Response('corrupt')
    }
    await assert.rejects(prepareWorkspaceRouterModel(directory, descriptor), /checksum mismatch/)
    assert.deepEqual(await readdir(directory), [])
  })
})
await test('stops after three gateway errors and preserves the existing file', async () => {
  await fixture(async (directory) => {
    const cached = Buffer.from('previous model')
    await writeFile(join(directory, 'model.onnx'), cached)
    let requests = 0
    globalThis.fetch = async () => {
      requests++
      return new Response('temporarily unavailable', { status: 502 })
    }
    await assert.rejects(prepareWorkspaceRouterModel(directory, model), /HTTP 502/)
    assert.equal(requests, 3)
    assert.deepEqual(await readFile(join(directory, 'model.onnx')), cached)
    assert.deepEqual(await readdir(directory), ['model.onnx'])
  })
})
await test('verifies bundled attribution before removing obsolete Julia assets', async () => {
  await fixture(async (directory) => {
    const license = Buffer.from('pinned upstream license')
    const descriptor = {
      ...model,
      files: [
        ...model.files,
        {
          name: 'LICENSE-APACHE-2.0.txt',
          size: license.length,
          sha256: createHash('sha256').update(license).digest('hex'),
        },
      ],
    }
    await writeFile(join(directory, 'model.onnx.data'), bytes)
    globalThis.fetch = async (url) =>
      new Response(url.endsWith('model.onnx') ? bytes : 'corrupt license')
    await assert.rejects(prepareWorkspaceRouterModel(directory, descriptor), /checksum mismatch/)
    assert.deepEqual(await readFile(join(directory, 'model.onnx.data')), bytes)
    globalThis.fetch = async () => new Response(license)
    await prepareWorkspaceRouterModel(directory, descriptor)
    assert.deepEqual(await readFile(join(directory, 'LICENSE-APACHE-2.0.txt')), license)
    assert.deepEqual((await readdir(directory)).sort(), ['LICENSE-APACHE-2.0.txt', 'model.onnx'])
  })
})
