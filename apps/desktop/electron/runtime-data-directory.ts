import { join } from 'node:path'
import { homedir } from 'node:os'

let directory = join(homedir(), '.dovo', 'desktop')

export function desktopRuntimeDirectory(): string {
  return directory
}

export function configureDesktopRuntimeDirectory(value: string): void {
  directory = value
}

export function desktopDataRoot(home: string, packaged: boolean): string {
  return join(home, packaged ? '.dovo' : '.dovo-dev')
}
