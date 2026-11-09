import { expect, it } from 'vite-plus/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Schema } from 'effect'
import { decode } from '@dovo/protocol'
import { stageServerSource } from './server-update'

const manifestSchema = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
it('stages every runtime workspace dependency and builds from its saved generated bundles', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const target = await mkdtemp(join(tmpdir(), 'dovo-update-source-'))
  try {
    await stageServerSource(root, target)
    const packages = new Map<string, string>()
    for (const category of ['apps', 'packages'])
      for (const entry of await readdir(join(target, category))) {
        const manifest = decode(
          manifestSchema,
          JSON.parse(await readFile(join(target, category, entry, 'package.json'), 'utf8')),
        )
        packages.set(manifest.name, join(category, entry))
      }
    const seen = new Set<string>()
    const verify = async (name: string) => {
      if (seen.has(name)) return
      seen.add(name)
      const path = packages.get(name)
      if (!path) throw new Error('Missing package ' + name)
      expect((await readdir(join(target, path, 'src'))).length).toBeGreaterThan(0)
      const manifest = decode(
        manifestSchema,
        JSON.parse(await readFile(join(target, path, 'package.json'), 'utf8')),
      )
      for (const [dependency, version] of Object.entries(manifest.dependencies ?? {}))
        if (version.startsWith('workspace:')) await verify(dependency)
    }
    await verify('@dovo/api')
    expect(seen).toContain('@dovo/durable-connections')
    expect(seen).toContain('@dovo/push')
    for (const name of ['protocol', 'client-runtime']) {
      const manifest = JSON.parse(
        await readFile(join(target, 'packages', name, 'package.json'), 'utf8'),
      )
      expect(manifest.scripts.build).toBe('tsc -p tsconfig.build.json')
    }
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
    expect(manifest.scripts.postinstall).toContain(
      'packages/durable-connections/tsconfig.build.json',
    )
    await expect(
      readFile(join(target, 'packages/protocol/src/generated/browser-viewer.ts')),
    ).resolves.toBeDefined()
    await expect(
      readFile(join(target, 'packages/client-runtime/src/images/image-editor-script.ts')),
    ).resolves.toBeDefined()
    await expect(readFile(join(target, 'apps/desktop/electron/main.ts'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
