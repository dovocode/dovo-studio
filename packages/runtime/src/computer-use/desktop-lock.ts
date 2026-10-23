import { exec } from '../process.js'

/** The WindowServer lock state remains readable when capture returns only black pixels. */
export async function desktopLocked() {
  if (process.platform !== 'darwin') return false
  // Both commands are built into macOS. plutil reads the native plist rather than parsing
  // ioreg's human-readable output or inferring a lock from the screenshot's appearance.
  const { stdout } = await exec(
    '/bin/bash',
    [
      '-o',
      'pipefail',
      '-c',
      '/usr/sbin/ioreg -n Root -d1 -a | /usr/bin/plutil -extract IOConsoleLocked raw -o - -',
    ],
    { timeout: 3000, maxBuffer: 4096 },
  )
  const value = stdout.trim()
  if (value !== 'true' && value !== 'false')
    throw new Error('macOS returned an unrecognized desktop lock state. Refresh to check again.')
  return value === 'true'
}
