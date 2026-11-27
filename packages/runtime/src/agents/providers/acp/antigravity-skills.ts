import { constants } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Schema } from 'effect'
import { decodeResult, type NativeSkill } from '@dovo/protocol'
import { parseSkillDocument } from '../../configuration/resources.js'

const manifests = ['.antigravity-plugin/plugin.json', '.gemini-plugin/plugin.json', 'plugin.json']
const manifestSchema = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  skills: Schema.optional(
    Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  ),
})
const preferencesSchema = Schema.Struct({
  plugins: Schema.optional(
    Schema.Record(Schema.String, Schema.Struct({ enabled: Schema.optional(Schema.Boolean) })),
  ),
})

function json(source: string | undefined): unknown {
  try {
    return source && JSON.parse(source.replace(/^\uFEFF/, ''))
  } catch {
    return undefined
  }
}

async function ifPresent<T>(operation: Promise<T>) {
  try {
    return await operation
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR'].includes(String(error.code))
    )
      return undefined
    throw error
  }
}

function inside(root: string, path: string) {
  const name = relative(root, path)
  return name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)
}

async function insidePath(root: string, path: string) {
  if (!inside(root, path)) return undefined
  const target = await ifPresent(realpath(path))
  return target && inside(root, target) ? target : undefined
}

/** Read only metadata from enabled plugins within the effective Antigravity profile. */
export async function antigravityPluginSkills(
  profile: string,
  signal: AbortSignal,
): Promise<NativeSkill[]> {
  const home = await ifPresent(realpath(profile))
  if (!home) return []
  const config = await insidePath(home, join(home, 'config'))
  const plugins = config && (await insidePath(config, join(config, 'plugins')))
  if (!config || !plugins) return []

  const skills = new Map<string, NativeSkill>()
  let entriesLeft = 2_000
  let bytesLeft = 4_000_000
  const readText = async (path: string) => {
    signal.throwIfAborted()
    const limit = Math.min(64_000, bytesLeft)
    if (!limit) return undefined
    const file = await ifPresent(
      open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
    )
    if (!file) return undefined
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > limit) return undefined
      const buffer = Buffer.alloc(limit + 1)
      const { bytesRead } = await file.read(buffer)
      bytesLeft = Math.max(0, bytesLeft - bytesRead)
      return bytesRead <= limit ? buffer.toString('utf8', 0, bytesRead) : undefined
    } finally {
      await file.close()
    }
  }
  const folders = async (directory: string) => {
    signal.throwIfAborted()
    const list = await ifPresent(opendir(directory))
    const result: string[] = []
    if (list)
      for await (const entry of list) {
        signal.throwIfAborted()
        if (entriesLeft <= 0) break
        entriesLeft--
        if (entry.isDirectory()) result.push(entry.name)
      }
    return result.sort()
  }
  const skillFile = async (plugin: string, path: string) => {
    const target = await insidePath(plugin, path)
    if (!target || basename(target).toLowerCase() !== 'skill.md') return false
    const source = await readText(target)
    if (!source) return false
    try {
      const { name, description } = parseSkillDocument(source)
      if (/^[\w.-]{1,120}$/.test(name) && !skills.has(name))
        skills.set(name, { name, description: description.slice(0, 600) })
    } catch {
      // One invalid skill does not hide the other skills in the plugin.
    }
    return true
  }
  const scan = async (plugin: string, path: string) => {
    const target = await insidePath(plugin, path)
    if (!target) return
    if (!(await ifPresent(stat(target)))?.isDirectory()) {
      await skillFile(plugin, target)
      return
    }
    if (await skillFile(plugin, join(target, 'SKILL.md'))) return
    for (const child of await folders(target)) {
      if (skills.size >= 200 || bytesLeft <= 0) break
      await skillFile(plugin, join(target, child, 'SKILL.md'))
    }
  }
  const settings = await insidePath(config, join(config, 'config.json'))
  const preferences = decodeResult(
    preferencesSchema,
    json(settings && (await readText(settings))),
  ).data
  for (const name of await folders(plugins)) {
    if (skills.size >= 200 || bytesLeft <= 0) break
    if (preferences?.plugins?.[name]?.enabled === false) continue
    const plugin = await insidePath(plugins, join(plugins, name))
    if (!plugin) continue
    for (const filename of manifests) {
      const path = await insidePath(plugin, join(plugin, filename))
      if (!path) continue
      const manifest = decodeResult(manifestSchema, json(await readText(path))).data
      if (manifest) {
        await scan(plugin, join(plugin, 'skills'))
        if (!manifest.$schema?.startsWith('https://agent-plugins.org/schemas/')) {
          const paths =
            typeof manifest.skills === 'string' ? [manifest.skills] : (manifest.skills ?? [])
          for (const entry of paths.slice(0, 200)) {
            if (skills.size >= 200 || bytesLeft <= 0) break
            await scan(plugin, resolve(plugin, entry))
          }
        }
      }
      break
    }
  }
  return [...skills.values()].sort((a, b) => a.name.localeCompare(b.name))
}
