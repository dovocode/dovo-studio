import { mkdtemp, cp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { prepareRuntime, copyPreparedRuntime } from './prepared-runtime.mjs'
import { releaseVariant } from './release-variant.mjs'
import { gpuiArchive } from './gpui-archive.mjs'
import { linuxDependencies, packageLinux } from './gpui-linux.mjs'
import { macInfoPlist, signMacGpui } from './gpui-mac.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
if (
  !['darwin', 'linux', 'win32'].includes(process.platform) ||
  !['arm64', 'x64'].includes(process.arch)
)
  throw new Error('GPUI archives support macOS/Linux/Windows arm64 and x64.')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Package with Node 24.')
const windows = process.platform === 'win32'
const mac = process.platform === 'darwin'
const flags = new Set(process.argv.slice(2))
for (const flag of flags)
  if (!['--dir', '--release', '--linux-packages'].includes(flag))
    throw new Error(`Unknown packaging option: ${flag}`)
if (flags.has('--dir') && !windows) throw new Error('--dir is for Windows signing stages')
if (flags.has('--linux-packages') && process.platform !== 'linux')
  throw new Error('--linux-packages requires Linux')
if (flags.has('--release') && windows && !flags.has('--dir'))
  throw new Error('Windows releases must be staged and signed before archiving')
const executable = `dovo-desktop-gpui${windows ? '.exe' : ''}`
const { version, nightly } = await releaseVariant(root)
const stage = await mkdtemp(join(tmpdir(), 'dovo-gpui-package-'))
try {
  const archive = join(stage, 'archive')
  const app = join(archive, 'Dovo Studio GPUI.app')
  const base = mac ? join(app, 'Contents/Resources') : archive
  const runtime = join(base, 'libexec/server')
  await mkdir(join(base, 'libexec'), { recursive: true })
  if (process.env.DOVO_PREPARED_RUNTIME) await copyPreparedRuntime(root, runtime)
  else await prepareRuntime(root, runtime)
  await cp(process.execPath, join(base, 'libexec', windows ? 'node.exe' : 'node'))
  await chmod(join(base, 'libexec', windows ? 'node.exe' : 'node'), 0o755)
  const binaryDirectory = mac ? join(app, 'Contents/MacOS') : archive
  await mkdir(binaryDirectory, { recursive: true })
  await cp(
    join(
      process.env.CARGO_TARGET_DIR || join(root, 'apps/desktop-gpui/target'),
      'release',
      executable,
    ),
    join(binaryDirectory, executable),
  )
  await chmod(join(binaryDirectory, executable), 0o755)
  await cp(join(root, 'apps/desktop-gpui/README.md'), join(base, 'README.md'))
  await mkdir(join(base, 'licenses'), { recursive: true })
  await cp(
    join(root, 'apps/desktop-gpui/assets/fonts/LICENSE.txt'),
    join(base, 'licenses/Inter.txt'),
  )
  await cp(
    join(root, 'packages/studio-ui/src/brand-icons.LICENSE.md'),
    join(base, 'licenses/brand-icons.md'),
  )
  await writeFile(join(base, 'VERSION'), `${version}\n`)
  if (process.platform === 'linux') {
    for (const file of [
      'install-linux.mjs',
      'install-linux.sh',
      'check-linux.mjs',
      'check-linux.sh',
    ])
      await cp(join(root, 'apps/desktop-gpui/packaging', file), join(archive, file))
    await chmod(join(archive, 'install-linux.sh'), 0o755)
    await chmod(join(archive, 'check-linux.sh'), 0o755)
    await writeFile(
      join(archive, 'linux-dependencies.json'),
      JSON.stringify(linuxDependencies, null, 2),
    )
    await cp(join(root, 'apps/desktop/build/icon.png'), join(archive, 'dovo-gpui.png'))
  }
  execFileSync(
    join(base, 'libexec', windows ? 'node.exe' : 'node'),
    [join(runtime, 'dist/server-cli.js'), '--help'],
    { stdio: 'inherit' },
  )
  const output = join(root, 'release')
  await mkdir(output, { recursive: true })
  if (mac) {
    await writeFile(join(app, 'Contents/Info.plist'), macInfoPlist(version))
    const iconset = join(stage, 'dovo-gpui.iconset')
    await mkdir(iconset)
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const pixels = String(size * scale)
        execFileSync(
          'sips',
          [
            '-z',
            pixels,
            pixels,
            join(root, 'apps/desktop/build/icon.png'),
            '--out',
            join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
          ],
          { stdio: 'inherit' },
        )
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(base, 'dovo-gpui.icns')], {
      stdio: 'inherit',
    })
    await signMacGpui({ root, app, stage, release: flags.has('--release') })
  }
  if (flags.has('--dir')) {
    const destination = join(output, `gpui-windows-${process.arch}`)
    await rm(destination, { recursive: true, force: true })
    await cp(archive, destination, { recursive: true, dereference: true })
    console.log(destination)
  } else {
    if (flags.has('--linux-packages'))
      await packageLinux({ archive, stage, output, version, nightly, arch: process.arch })
    console.log(
      await gpuiArchive({
        directory: archive,
        output,
        version,
        nightly,
        platform: process.platform,
        arch: process.arch,
      }),
    )
  }
} finally {
  await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
