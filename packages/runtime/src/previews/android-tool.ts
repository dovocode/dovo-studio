import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export async function androidTool(tool: 'adb' | 'emulator') {
  const defaultRoot = join(
    homedir(),
    process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk',
  )
  const root =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk')
      : defaultRoot)
  for (const directory of new Set([root, defaultRoot])) {
    const path = join(
      directory,
      tool === 'adb' ? 'platform-tools' : 'emulator',
      process.platform === 'win32' ? `${tool}.exe` : tool,
    )
    try {
      await access(path)
      return path
    } catch {
      // An unavailable SDK location falls through to the next location or PATH.
    }
  }
  return tool
}
