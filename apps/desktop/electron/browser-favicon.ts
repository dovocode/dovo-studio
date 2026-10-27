import { createRequire } from 'node:module'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'

/** The packaged Node dependency tree lives beside app.asar, not inside it. */
export function loadBrowserFaviconModule(resourcesPath?: string) {
  const require = createRequire(
    resourcesPath
      ? realpathSync(join(resourcesPath, 'runtime/node_modules/@dovo/runtime/package.json'))
      : import.meta.url,
  )
  const favicon: typeof import('@dovo/runtime/browser-favicon') = require('@dovo/runtime/browser-favicon')
  return favicon
}
