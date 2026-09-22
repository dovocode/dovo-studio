import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
export const exec = promisify(execFile)
export function processEnvironment() {
  const env = { ...process.env }
  delete env.DOVO_OWNER_TOKEN
  delete env.ELECTRON_RUN_AS_NODE
  // A parent shell must not redirect commands away from the selected project checkout.
  for (const key of [
    'GH_REPO',
    'GH_HOST',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_PREFIX',
  ])
    delete env[key]
  return env
}
export async function executableAvailable(command: string) {
  try {
    await exec(command, ['--version'], {
      timeout: 5000,
      env: processEnvironment(),
      maxBuffer: 1024 * 1024,
    })
    return true
  } catch {
    return false
  }
}
