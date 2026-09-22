import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { z } from 'zod'
import { catalogSearchSchema, skillCatalogSchema, skillCatalogImportSchema } from '@dovo/protocol'
import { catalogBytes, catalogJson } from './fetch.js'
import { importSkill } from '../resources.js'
export async function searchSkills(input: unknown) {
  const { query } = catalogSearchSchema.parse(input)
  if (query.length < 2) return { entries: [] }
  const result = z
    .object({
      skills: z.array(
        z.object({
          id: z.string(),
          skillId: z.string().optional(),
          name: z.string(),
          source: z.string(),
          installs: z.number().default(0),
        }),
      ),
    })
    .parse(
      await catalogJson(
        `https://skills.sh/api/search?${new URLSearchParams({ q: query, limit: '20' })}`,
      ),
    )
  return skillCatalogSchema.parse({
    entries: result.skills.map((skill) => ({
      ...skill,
      id: skill.skillId ?? skill.id.split('/').at(-1),
      url: `https://skills.sh/${skill.id.split('/').map(encodeURIComponent).join('/')}`,
      supported: skillCatalogImportSchema.safeParse({
        source: skill.source,
        skill: skill.skillId ?? skill.id.split('/').at(-1),
      }).success,
    })),
  })
}
const fileSchema = z.object({
  path: z.string(),
  type: z.string(),
  mode: z.string(),
  size: z.number().optional(),
})
export async function installCatalogSkill(input: unknown, root: string) {
  const { source, skill } = skillCatalogImportSchema.parse(input)
  const api = `https://api.github.com/repos/${source}`
  const commit = z
    .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
    .parse(await catalogJson(`${api}/commits/HEAD`))
  const tree = z
    .object({ truncated: z.boolean(), tree: z.array(fileSchema) })
    .parse(await catalogJson(`${api}/git/trees/${commit.sha}?recursive=1`, 8_000_000))
  if (tree.truncated)
    throw new Error(
      'This repository is too large to import automatically. Import a local SKILL.md instead.',
    )
  const candidates = tree.tree.filter(
    (file) =>
      file.type === 'blob' &&
      basename(file.path) === 'SKILL.md' &&
      (basename(dirname(file.path)) === skill || file.path === 'SKILL.md'),
  )
  if (candidates.length !== 1)
    throw new Error(
      'Could not locate one matching skill directory. Import the skill from a local SKILL.md instead.',
    )
  const selected = candidates[0]
  const directory = posix.dirname(selected.path)
  const prefix = directory === '.' ? '' : `${directory}/`
  const files = tree.tree.filter((file) => file.path.startsWith(prefix) && file.type !== 'tree')
  if (files.length > 200 || files.reduce((size, file) => size + (file.size ?? 0), 0) > 8_000_000)
    throw new Error('Skill bundle exceeds 200 files or 8 MB')
  for (const file of files) {
    const relative = file.path.slice(prefix.length)
    if (
      file.type !== 'blob' ||
      !['100644', '100755'].includes(file.mode) ||
      relative.includes('\\') ||
      relative.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Skill bundles must contain regular files without symlinks or parent paths')
  }
  await mkdir(root, { recursive: true })
  const destination = join(
    root,
    createHash('sha256').update(`${source}:${commit.sha}:${directory}`).digest('hex'),
  )
  const staging = await mkdtemp(join(root, '.import-'))
  try {
    let bytes = 0
    for (let i = 0; i < files.length; i += 4) {
      const results = await Promise.allSettled(
        files.slice(i, i + 4).map(async (file) => {
          const contents = await catalogBytes(
            `https://raw.githubusercontent.com/${source}/${commit.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
            8_000_000,
          )
          bytes += contents.length
          if (bytes > 8_000_000) throw new Error('Skill bundle exceeds 8 MB')
          const path = join(staging, file.path.slice(prefix.length))
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, contents, {
            mode: file.mode === '100755' ? 0o700 : 0o600,
            flag: 'wx',
          })
        }),
      )
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    const imported = await importSkill({ path: join(staging, 'SKILL.md') })
    if (imported.name !== skill)
      throw new Error('Skill metadata does not match the selected catalog entry')
    try {
      await rename(staging, destination)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        !['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
      )
        throw error
      // An immutable copy of the same repository revision already exists.
    }
    return {
      ...imported,
      sourcePath: join(destination, 'SKILL.md'),
      sourceUrl: `https://skills.sh/${source}/${skill}`,
      sourceRevision: commit.sha,
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
