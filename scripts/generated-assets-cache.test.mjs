import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { generatedAssetsCache } from './generated-assets-cache.mjs'

await test('invalidates generated bundles on imported file, script, output and dynamic input changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-generated-assets-'))
  const name = `cache-test-${randomUUID()}.mjs`
  const script = pathToFileURL(join(directory, name))
  const output = new URL('output.json', script)
  const dependency = join(directory, 'dependency.ts')
  const cacheFile = new URL(
    `../node_modules/.cache/dovo-generated-assets/${name}.json`,
    import.meta.url,
  )
  const open = (extra = []) => generatedAssetsCache(script.href, [output.href], extra)
  try {
    await writeFile(script, '// generator')
    await writeFile(output, 'generated')
    await writeFile(dependency, 'original')
    const initial = await open()
    assert.equal(initial.current, false)
    await initial.save([dependency])
    assert.equal((await open()).current, true)
    await writeFile(dependency, 'changed')
    assert.equal((await open()).current, false)
    await (await open()).save([dependency])
    assert.equal((await open()).current, true)
    await writeFile(script, '// changed generator')
    assert.equal((await open()).current, false)
    await (await open()).save([dependency])
    await writeFile(output, 'edited output')
    assert.equal((await open()).current, false)
    await (await open()).save([dependency])
    await writeFile(join(directory, 'new-css-source.tsx'), 'new classes')
    assert.equal((await open([join(directory, 'new-css-source.tsx')])).current, false)
    await rm(output)
    assert.equal((await open()).current, false)
    await writeFile(output, 'regenerated')
    // A partial or malformed cache is a miss, never permission to skip generation.
    await writeFile(cacheFile, JSON.stringify({ inputs: [dependency] }))
    assert.equal((await open()).current, false)
    await writeFile(cacheFile, '{')
    assert.equal((await open()).current, false)
    assert.equal(await readFile(output, 'utf8'), 'regenerated')
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(cacheFile, { force: true })
  }
})
