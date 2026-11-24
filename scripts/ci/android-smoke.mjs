import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function launchLostAdb(directory) {
  const files = await readdir(directory, { recursive: true, withFileTypes: true })
  const report = files.find((entry) => entry.isFile() && entry.name === 'commands.json')
  if (!report) return false
  try {
    const commands = JSON.parse(await readFile(join(report.parentPath, report.name), 'utf8'))
    const failed = commands.find((entry) => entry.metadata?.status === 'FAILED')
    return (
      failed?.command?.launchAppCommand?.clearState === true &&
      /\bdevice offline\b/i.test(failed.metadata.error?.message ?? '')
    )
  } catch {
    return false
  }
}

export async function runAndroidSmoke(diagnostics, run, waitForDevice) {
  const attempt = () => mkdtemp(join(diagnostics, 'android-maestro-'))
  const first = await attempt()
  const result = await run(first)
  if (result === 0 || !(await launchLostAdb(first))) return result
  console.log(
    'ADB disconnected during the Android smoke launch. Waiting for the emulator to reconnect.',
  )
  try {
    await waitForDevice()
  } catch (error) {
    console.error('ADB did not reconnect before the retry deadline:', error.message)
    return result
  }
  return run(await attempt())
}
