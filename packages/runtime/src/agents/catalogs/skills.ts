import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import { Schema, Effect } from 'effect'
import {
  catalogSearchSchema,
  skillCatalogSchema,
  skillCatalogImportSchema,
  skillPackageImportSchema,
} from '@dovo/protocol'
import { catalogBytes, catalogJson } from './fetch.js'
import { importSkill, parseSkillDocument } from '../configuration/resources.js'
export async function searchSkills(input: unknown) {
  const { query } = decode(catalogSearchSchema, input)
  if (query.length < 2)
    return {
      entries: [],
    }
  const result = decode(
    mutableStruct({
      skills: mutableArray(
        mutableStruct({
          id: Schema.String,
          skillId: Schema.optional(Schema.String),
          name: Schema.String,
          source: Schema.String,
          installs: Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
            Schema.withDecodingDefaultType(Effect.sync(() => 0)),
          ),
        }),
      ),
    }),
    await catalogJson(
      `https://skills.sh/api/search?${new URLSearchParams({
        q: query,
        limit: '20',
      })}`,
    ),
  )
  return decode(skillCatalogSchema, {
    entries: result.skills.map((skill) => ({
      ...skill,
      id: skill.skillId ?? skill.id.split('/').at(-1),
      url: `https://skills.sh/${skill.id.split('/').map(encodeURIComponent).join('/')}`,
      supported: decodeResult(skillCatalogImportSchema, {
        source: skill.source,
        skill: skill.skillId ?? skill.id.split('/').at(-1),
      }).success,
    })),
  })
}
const fileSchema = mutableStruct({
  path: Schema.String,
  type: Schema.String,
  mode: Schema.String,
  size: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
})
async function resolveCatalogSkill(input: unknown) {
  const { source, skill, revision } = decode(skillCatalogImportSchema, input)
  const api = `https://api.github.com/repos/${source}`
  const commit = decode(
    mutableStruct({
      sha: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{40}$/))),
    }),
    await catalogJson(`${api}/commits/${revision ?? 'HEAD'}`),
  )
  if (revision && commit.sha !== revision)
    throw new Error('The skill catalog returned a different revision')
  const tree = decode(
    mutableStruct({
      truncated: Schema.Boolean,
      tree: mutableArray(fileSchema),
    }),
    await catalogJson(`${api}/git/trees/${commit.sha}?recursive=1`, 8_000_000),
  )
  if (tree.truncated)
    throw new Error(
      'This repository is too large to import automatically. Import a local SKILL.md instead.',
    )
  const manifests = tree.tree.filter(
    (file) => file.type === 'blob' && basename(file.path) === 'SKILL.md',
  )
  const documents = new Map<string, Buffer>()
  const matching: Schema.Schema.Type<typeof fileSchema>[] = []
  const direct = manifests.filter(
    (file) => basename(dirname(file.path)) === skill || file.path === 'SKILL.md',
  )
  const discover = async (candidates: typeof manifests) => {
    if (
      candidates.length > 200 ||
      candidates.reduce((total, file) => total + (file.size ?? 0), 0) > 8_000_000
    )
      throw new Error(
        'Too many skill definitions to search automatically. Import a local SKILL.md instead.',
      )
    for (let i = 0; i < candidates.length; i += 4) {
      const results = await Promise.allSettled(
        candidates.slice(i, i + 4).map(async (file) => {
          if (
            !['100644', '100755'].includes(file.mode) ||
            file.path.includes('\\') ||
            file.path.split('/').some((part) => !part || part === '.' || part === '..')
          )
            throw new Error(
              'Skill definitions must be regular files without symlinks or parent paths',
            )
          const contents = await catalogBytes(
            `https://raw.githubusercontent.com/${source}/${commit.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
            64_000,
          )
          documents.set(file.path, contents)
          // Unrelated malformed definitions must not prevent importing a valid selected skill.
          let name: string
          try {
            name = parseSkillDocument(contents.toString('utf8')).name
          } catch {
            return
          }
          if (name === skill) matching.push(file)
        }),
      )
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
  }
  await discover(direct)
  if (!matching.length) await discover(manifests.filter((file) => !direct.includes(file)))
  // Prefer the repository-root portable bundle over provider-specific copies.
  const portable = matching.filter((file) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(file.path))
  const candidates = portable.length ? portable : matching
  if (candidates.length !== 1)
    throw new Error(
      `Could not locate one SKILL.md declaring "${skill}". Import the skill from a local SKILL.md instead.`,
    )
  const selected = candidates[0]
  return { source, skill, revision: commit.sha, selected, manifests, documents, tree: tree.tree }
}

async function packageSkills(bundle: Awaited<ReturnType<typeof resolveCatalogSkill>>) {
  const directory = posix.dirname(posix.dirname(bundle.selected.path))
  const manifests = bundle.manifests.filter(
    (file) => posix.dirname(posix.dirname(file.path)) === directory,
  )
  if (manifests.length > 200) throw new Error('Package exceeds 200 skill definitions')
  const entries = []
  for (const file of manifests) {
    if (
      !['100644', '100755'].includes(file.mode) ||
      file.path.includes('\\') ||
      file.path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Skill definitions must be regular files without symlinks or parent paths')
    const contents =
      bundle.documents.get(file.path) ??
      (await catalogBytes(
        `https://raw.githubusercontent.com/${bundle.source}/${bundle.revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
        64_000,
      ))
    bundle.documents.set(file.path, contents)
    const skill = parseSkillDocument(contents.toString('utf8'))
    entries.push({
      ...skill,
      path: file.path,
      sourceUrl: `https://skills.sh/${bundle.source}/${skill.name}`,
      sourceRevision: bundle.revision,
      sourcePackage: true,
    })
  }
  if (new Set(entries.map((skill) => skill.name)).size !== entries.length)
    throw new Error('Package contains duplicate skill names')
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

export async function previewSkillPackage(input: unknown) {
  const bundle = await resolveCatalogSkill(input)
  const skills = await packageSkills(bundle)
  return {
    source: bundle.source,
    revision: bundle.revision,
    skills: skills.map(({ path: _path, ...skill }) => skill),
  }
}

export async function installSkillPackage(input: unknown, root: string) {
  const options = decode(skillPackageImportSchema, input)
  if (!options.revision) throw new Error('Preview the package before installing it')
  const bundle = await resolveCatalogSkill(options)
  const skills = await packageSkills(bundle)
  if (
    new Set(options.skills).size !== options.skills.length ||
    options.skills.some((name) => !skills.some((skill) => skill.name === name))
  )
    throw new Error('Choose skills from the package preview')
  const destination = await writeBundle({ ...bundle, package: true }, root)
  const directory = posix.dirname(posix.dirname(bundle.selected.path))
  const prefix = directory === '.' ? '' : `${directory}/`
  return {
    source: bundle.source,
    revision: bundle.revision,
    skills: skills
      .filter((skill) => options.skills.includes(skill.name))
      .map(({ path, ...skill }) => ({
        ...skill,
        sourcePath: join(destination, path.slice(prefix.length)),
      })),
  }
}

export async function installCatalogSkill(input: unknown, root: string) {
  const options = decode(skillCatalogImportSchema, input)
  const bundle = await resolveCatalogSkill(options)
  const destination = await writeBundle({ ...bundle, package: options.package }, root)
  const directory = options.package
    ? posix.dirname(posix.dirname(bundle.selected.path))
    : posix.dirname(bundle.selected.path)
  const prefix = directory === '.' ? '' : `${directory}/`
  const imported = await importSkill({
    path: join(destination, bundle.selected.path.slice(prefix.length)),
  })
  return {
    ...imported,
    sourceUrl: `https://skills.sh/${bundle.source}/${bundle.skill}`,
    sourceRevision: bundle.revision,
    ...(options.package ? { sourcePackage: true } : {}),
  }
}

async function writeBundle(
  bundle: Awaited<ReturnType<typeof resolveCatalogSkill>> & { package?: boolean },
  root: string,
) {
  const { source, revision, selected, documents } = bundle
  const skillDirectory = posix.dirname(selected.path)
  const directory = bundle.package ? posix.dirname(skillDirectory) : skillDirectory
  const prefix = directory === '.' ? '' : `${directory}/`
  const files = bundle.tree.filter((file) => file.path.startsWith(prefix) && file.type !== 'tree')
  const maxFiles = bundle.package ? 2000 : 200
  const maxBytes = bundle.package ? 32_000_000 : 8_000_000
  if (
    files.length > maxFiles ||
    files.reduce((size, file) => size + (file.size ?? 0), 0) > maxBytes
  )
    throw new Error(`Skill bundle exceeds ${maxFiles} files or ${maxBytes / 1_000_000} MB`)
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
  await mkdir(root, {
    recursive: true,
  })
  const destination = join(
    root,
    createHash('sha256').update(`${source}:${revision}:${directory}`).digest('hex'),
  )
  const staging = await mkdtemp(join(root, '.import-'))
  try {
    let bytes = 0
    for (let i = 0; i < files.length; i += 4) {
      const results = await Promise.allSettled(
        files.slice(i, i + 4).map(async (file) => {
          const contents =
            documents.get(file.path) ??
            (await catalogBytes(
              `https://raw.githubusercontent.com/${source}/${revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
              8_000_000,
            ))
          bytes += contents.length
          if (bytes > maxBytes) throw new Error(`Skill bundle exceeds ${maxBytes / 1_000_000} MB`)
          const path = join(staging, file.path.slice(prefix.length))
          await mkdir(dirname(path), {
            recursive: true,
          })
          await writeFile(path, contents, {
            mode: file.mode === '100755' ? 0o700 : 0o600,
            flag: 'wx',
          })
        }),
      )
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
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
    return destination
  } finally {
    await rm(staging, {
      recursive: true,
      force: true,
    })
  }
}
