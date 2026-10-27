import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Applies only to disposable Linux CI runners. Keep Ubuntu signatures and all repositories.
export async function configureApt(directory = '/etc/apt') {
  await writeFile(
    join(directory, 'apt.conf.d/99dovo-ci'),
    'Acquire::Retries "2";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nDpkg::Lock::Timeout "120";\n',
  )
}

export async function usePrimaryUbuntuMirror(directory = '/etc/apt') {
  const sources = join(directory, 'sources.list.d')
  const paths = [
    join(directory, 'sources.list'),
    // Hosted Ubuntu uses mirror+file: sources; changing only .sources is ineffective.
    join(directory, 'apt-mirrors.txt'),
    join(directory, 'apt-mirrors-security.txt'),
    ...(await readdir(sources))
      .filter((name) => /\.(list|sources)$/.test(name))
      .map((name) => join(sources, name)),
  ]
  let changed = 0
  for (const path of paths) {
    let before
    try {
      before = await readFile(path, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    const after = before.replace(
      /\b(https?:\/\/)azure\.archive\.ubuntu\.com(?=\/ubuntu(?:\/|\s|$))/g,
      '$1archive.ubuntu.com',
    )
    if (after !== before) {
      await writeFile(path, after)
      changed++
    }
  }
  return changed
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'configure') await configureApt()
  else if (process.argv[2] === 'fallback')
    console.log(
      `Switched ${await usePrimaryUbuntuMirror()} Ubuntu source files to the primary mirror.`,
    )
  else throw new Error('Usage: node scripts/ci/linux-apt.mjs configure|fallback')
}
