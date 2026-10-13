import { mkdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { releaseVariant } from './release-variant.mjs'

// Git Bash can put GNU tar first on PATH; it treats Windows drive letters as
// remote hosts and cannot create ZIPs. Windows ships a ZIP-capable bsdtar.
export const tarExecutable =
  process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'

export async function gpuiArchive({ directory, output, version, nightly, platform, arch }) {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch))
    throw new Error('Unsupported GPUI archive platform or architecture')
  const windows = platform === 'win32'
  await access(
    join(
      directory,
      platform === 'darwin'
        ? 'Dovo Studio GPUI.app/Contents/MacOS/dovo-desktop-gpui'
        : `dovo-desktop-gpui${windows ? '.exe' : ''}`,
    ),
  )
  await mkdir(output, { recursive: true })
  const os = windows ? 'windows' : platform === 'darwin' ? 'macos' : 'linux'
  const path = join(
    output,
    `Dovo-GPUI${nightly ? '-Nightly' : ''}-${version}-${os}-${arch}.${windows ? 'zip' : 'tar.gz'}`,
  )
  execFileSync(tarExecutable, [windows ? '-acf' : '-czf', path, '-C', directory, '.'], {
    stdio: 'inherit',
  })
  return path
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Windows ARM64 binaries are signed on an x64 host. Archive after signing without
  // re-staging (which would replace the signed binaries with unsigned copies).
  const [directory, arch] = process.argv.slice(2)
  if (!directory || !['x64', 'arm64'].includes(arch) || process.platform !== 'win32')
    throw new Error('Usage on Windows: gpui-archive.mjs <signed-directory> <x64|arm64>')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  console.log(
    await gpuiArchive({
      directory: resolve(directory),
      output: join(root, 'release'),
      ...(await releaseVariant(root)),
      platform: process.platform,
      arch,
    }),
  )
}
