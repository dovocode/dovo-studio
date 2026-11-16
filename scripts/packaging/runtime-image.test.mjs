import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)

void test('the runtime image uses the repository Node version in every stage', async () => {
  const node = (await readFile(new URL('.node-version', root), 'utf8')).trim()
  const dockerfile = await readFile(new URL('apps/api/Dockerfile', root), 'utf8')
  const images = [...dockerfile.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/gm)].map(
    (match) => match[1],
  )
  assert.ok(images.length >= 2)
  // The archive brings its own Node; the base Node runs npm-installed agent CLIs and health checks.
  for (const image of images) assert.equal(image, `node:${node}-trixie-slim`)
})
