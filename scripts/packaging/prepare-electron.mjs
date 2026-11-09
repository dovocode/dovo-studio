import { createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { releaseDownloader } from './github-release-download.mjs'

/** Use Electron's cache and checksum validator with a download gateway fallback. */
export async function prepareElectron() {
  const desktop = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
  const electron = createRequire(desktop.resolve('electron/package.json'))
  const { version } = JSON.parse(await readFile(electron.resolve('./package.json'), 'utf8'))
  const checksums = JSON.parse(await readFile(electron.resolve('./checksums.json'), 'utf8'))
  const { downloadArtifact } = await import(pathToFileURL(electron.resolve('@electron/get')).href)
  const download = releaseDownloader(
    `https://github.com/electron/electron/releases/download/v${version}`,
  )
  const name = `electron-v${version}-${process.platform}-${process.arch}.zip`
  if (!/^[a-f0-9]{64}$/.test(checksums[name] ?? ''))
    throw new Error(`The locked Electron package has no checksum for ${name}`)
  const archive = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    cacheRoot: process.env.electron_config_cache ?? process.env.ELECTRON_CACHE,
    checksums,
    downloader: {
      async download(_url, destination) {
        const response = await download(name)
        if (!response.ok || !response.body)
          throw new Error(`Could not download ${name}: HTTP ${response.status}`)
        await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
      },
    },
  })
  return { version, archive }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { version, archive } = await prepareElectron()
  console.log(`Verified Electron ${version}: ${archive}`)
}
