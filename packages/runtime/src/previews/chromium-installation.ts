import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { exec } from '../process.js'

// Playwright's executable path includes its required revision. An older cached
// revision therefore cannot satisfy this check after a Studio upgrade.
export class ChromiumInstallation {
  private pending?: Promise<string>
  private controller = new AbortController()

  ensure(): Promise<string> {
    if (this.controller.signal.aborted) return Promise.reject(new Error('Runtime is shutting down'))
    if (process.env.DOVO_BROWSER_EXECUTABLE)
      return Promise.resolve(process.env.DOVO_BROWSER_EXECUTABLE)
    if (!this.pending) {
      this.pending = this.install().finally(() => {
        this.pending = undefined
      })
    }
    return this.pending
  }

  private async install() {
    const { chromium } = await import('playwright')
    const executable = chromium.executablePath()
    if (existsSync(executable)) return executable
    const require = createRequire(import.meta.url)
    const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js')
    console.log('Installing the Playwright Chromium revision required by Dovo Studio')
    await exec(process.execPath, [cli, 'install', 'chromium'], {
      signal: this.controller.signal,
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    })
    if (!existsSync(executable))
      throw new Error('Playwright did not install its required Chromium executable')
    return executable
  }

  async dispose() {
    this.controller.abort()
    await this.pending?.catch(() => {})
  }
}
