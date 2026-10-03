import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, rm, stat } from 'node:fs/promises'
import { join, relative, isAbsolute, resolve } from 'node:path'
import {
  catalogSkillSource,
  decodeResult,
  managedSkillSchema,
  type ManagedSkill,
} from '@dovo/protocol'
import { installCatalogSkill } from '../catalogs/skills.js'

/** Pinned public bundles are installed on the host that runs the thread, never at a foreign path. */
export class SharedSkillBundles {
  private pending = new Map<string, Promise<ManagedSkill>>()
  constructor(private root: string) {}
  async materialize(skills: readonly ManagedSkill[]) {
    return Promise.all(
      skills.map(async (skill) => {
        const source = !skill.sourcePath ? catalogSkillSource(skill) : undefined
        if (!source) return skill
        const key = createHash('sha256').update(JSON.stringify(source)).digest('hex')
        let pending = this.pending.get(key)
        if (!pending) {
          pending = this.install(source, key).catch((error) => {
            this.pending.delete(key)
            throw error
          })
          this.pending.set(key, pending)
          while (this.pending.size > 64) {
            const oldest = this.pending.keys().next().value
            if (oldest !== undefined) this.pending.delete(oldest)
          }
        }
        const installed = await pending
        return { ...skill, sourcePath: installed.sourcePath }
      }),
    )
  }
  private async install(source: { source: string; skill: string; revision: string }, key: string) {
    const index = join(this.root, `.shared-${key}.json`)
    try {
      const result = decodeResult(managedSkillSchema, JSON.parse(await readFile(index, 'utf8')))
      const saved = result.success ? result.data : undefined
      const path = saved?.sourcePath
      if (path && saved && JSON.stringify(catalogSkillSource(saved)) === JSON.stringify(source)) {
        const local = relative(resolve(this.root), resolve(path))
        if (
          !isAbsolute(local) &&
          local !== '..' &&
          !local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
          (await stat(path)).isFile()
        )
          return saved
      }
    } catch (error) {
      // A missing/stale disposable index can be rebuilt; a filesystem failure must remain visible.
      if (
        !(error instanceof SyntaxError) &&
        (!(error instanceof Error) ||
          !('code' in error) ||
          !['ENOENT', 'ENOTDIR'].includes(String(error.code)))
      )
        throw error
    }
    const skill = await installCatalogSkill(source, this.root)
    await mkdir(this.root, { recursive: true })
    const staging = `${index}.${randomUUID()}.tmp`
    try {
      await writeFile(staging, JSON.stringify(skill), { mode: 0o600, flag: 'wx' })
      await rename(staging, index)
    } finally {
      await rm(staging, { force: true })
    }
    return skill
  }
}
