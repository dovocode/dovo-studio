import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export function rendererSourceCommit(root) {
  try {
    const value = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return /^[0-9a-f]{40}$/.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function rendererBuildIdentity(root) {
  const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  if (typeof version !== 'string' || !version) throw new Error('Renderer version is missing')
  const commit = rendererSourceCommit(root)
  return { version, ...(commit ? { commit } : {}) }
}
