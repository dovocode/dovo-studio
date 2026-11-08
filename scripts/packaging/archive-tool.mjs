import { win32 } from 'node:path'

// Git Bash can put GNU tar first on PATH. It treats drive letters as remote hosts and
// cannot create the ZIP archives produced by Windows' built-in BSD tar.
export function archiveTool(
  platform = process.platform,
  systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
) {
  return platform === 'win32' ? win32.join(systemRoot, 'System32', 'tar.exe') : 'tar'
}
