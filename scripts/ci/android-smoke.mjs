import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'

export async function runAndroidSmoke(diagnostics, run) {
  return run(await mkdtemp(join(diagnostics, 'android-maestro-')))
}
