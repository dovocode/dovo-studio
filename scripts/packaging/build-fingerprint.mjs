import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

async function files(root, paths) {
  const result = []
  for (const path of paths) {
    let entries
    try {
      entries = await readdir(join(root, path), { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOTDIR') {
        result.push(path)
        continue
      }
      if (error.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (entry.name === '.dovo-build.json' || /\.test\.[jt]sx?$/.test(entry.name)) continue
      const name = `${path}/${entry.name}`
      if (entry.isDirectory()) result.push(...(await files(root, [name])))
      else if (entry.isFile()) result.push(name)
    }
  }
  return result.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
export async function buildDigest(root, paths) {
  const hash = createHash('sha256')
  for (const path of await files(root, paths)) {
    const content = await readFile(join(root, path))
    hash.update(JSON.stringify([path, content.length])).update(content)
  }
  return hash.digest('hex')
}
