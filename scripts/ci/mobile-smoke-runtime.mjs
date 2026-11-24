import { execFileSync } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function mobileSmokeRuntime(currentCheckout, previousCheckout) {
  const path = 'packages/runtime/dist/index.js'
  if (!previousCheckout) return import(pathToFileURL(join(currentCheckout, path)).href)

  const current = await realpath(currentCheckout)
  const previous = await realpath(previousCheckout)
  const git = (directory, ...args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  if ((await realpath(git(previous, 'rev-parse', '--show-toplevel'))) !== previous)
    throw new Error('Pass the root of the previous runtime checkout')
  const sha = git(previous, 'rev-parse', 'HEAD')
  if (sha === git(current, 'rev-parse', 'HEAD'))
    throw new Error('The previous mobile smoke runtime must come from a different commit')
  try {
    git(current, 'merge-base', '--is-ancestor', sha, 'HEAD')
  } catch {
    throw new Error('Select a previous runtime commit from this repository')
  }
  if (git(previous, 'status', '--porcelain', '--untracked-files=no'))
    throw new Error('Build the previous mobile smoke runtime from a clean checkout')
  const entrypoint = join(previous, path)
  await access(entrypoint).catch((cause) => {
    throw new Error('Build the previous runtime checkout before running the mobile smoke', {
      cause,
    })
  })
  const runtime = await import(pathToFileURL(entrypoint).href)
  if (typeof runtime.startRuntime !== 'function')
    throw new Error('The previous runtime does not export startRuntime')
  console.log(`Native mobile smoke uses runtime source ${sha}.`)
  return runtime
}
