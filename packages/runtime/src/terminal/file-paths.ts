import { win32 } from 'node:path'
import { quote } from 'shell-quote'
import { HttpError } from '../errors.js'

/** Quote for the shell this terminal launched, without executing or submitting input. */
export function quoteTerminalPaths(paths: readonly string[], command: string): string {
  if (paths.some((path) => !path || /\p{Cc}/u.test(path)))
    throw new HttpError(400, 'Dropped file paths must not contain control characters.')
  const shell = win32
    .basename(command)
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (shell === 'powershell' || shell === 'pwsh')
    return paths.map((path) => `'${path.replaceAll("'", "''")}'`).join(' ') + ' '
  if (shell === 'cmd') {
    if (paths.some((path) => /["%!]/u.test(path)))
      throw new HttpError(400, 'CMD cannot safely paste paths containing quotes, % or !.')
    return paths.map((path) => `"${path}"`).join(' ') + ' '
  }
  return quote([...paths]) + ' '
}
