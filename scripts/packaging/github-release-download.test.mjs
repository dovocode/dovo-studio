import assert from 'node:assert/strict'
import { test } from 'node:test'
import { releaseDownloader } from './github-release-download.mjs'

await test('authenticates only GitHub API requests and strips credentials from asset redirects', async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.GH_TOKEN
  process.env.GH_TOKEN = 'test-workflow-token'
  const requests = []
  try {
    globalThis.fetch = async (url, options) => {
      requests.push(url)
      if (url === 'https://github.com/team/models/releases/download/pinned/model.zip') {
        assert.equal(options.headers.Authorization, undefined)
        return new Response(null, { status: 504 })
      }
      if (url === 'https://release-assets.githubusercontent.com/model.zip') {
        assert.equal(options.headers.Authorization, undefined)
        return new Response('verified by caller')
      }
      assert.equal(options.headers.Authorization, 'Bearer test-workflow-token')
      assert.equal(options.redirect, 'manual')
      if (url === 'https://api.github.com/repos/team/models/releases/tags/pinned')
        return Response.json({ assets: [{ name: 'model.zip', id: 42 }] })
      assert.equal(url, 'https://api.github.com/repos/team/models/releases/assets/42')
      assert.equal(options.headers.Accept, 'application/octet-stream')
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://release-assets.githubusercontent.com/model.zip' },
      })
    }
    const response = await releaseDownloader(
      'https://github.com/team/models/releases/download/pinned',
    )('model.zip')
    assert.equal(await response.text(), 'verified by caller')
    assert.equal(requests.length, 4)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.GH_TOKEN
    else process.env.GH_TOKEN = originalToken
  }
})
