import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { desktopEntry } from '../../apps/desktop-gpui/packaging/install-linux.mjs'

// Vulkan and fontconfig are opened dynamically, so ELF auto-requires alone are insufficient.
export const linuxDependencies = {
  deb: [
    'libc6 (>= 2.39)',
    'libstdc++6',
    'libgcc-s1',
    'libdbus-1-3',
    'libgtk-3-0t64 | libgtk-3-0',
    'libwebkit2gtk-4.1-0',
    'libjavascriptcoregtk-4.1-0',
    'libsoup-3.0-0',
    'libglib2.0-0t64 | libglib2.0-0',
    'libxcb1',
    'libxkbcommon0',
    'libxkbcommon-x11-0',
    'libfontconfig1',
    'libvulkan1',
    'mesa-vulkan-drivers',
    'fonts-dejavu-core',
    'xwayland',
    'xdg-utils',
  ],
  rpm: [
    'glibc >= 2.39',
    'libstdc++',
    'libgcc',
    'dbus-libs',
    'gtk3',
    'webkit2gtk4.1',
    'javascriptcoregtk4.1',
    'libsoup3',
    'glib2',
    'libxcb',
    'libxkbcommon',
    'libxkbcommon-x11',
    'fontconfig',
    'vulkan-loader',
    'mesa-vulkan-drivers',
    'dejavu-sans-fonts',
    'xorg-x11-server-Xwayland',
    'xdg-utils',
  ],
}

export function requiredGlibc(output) {
  const versions = [...output.matchAll(/\bGLIBC_(\d+)\.(\d+)\b/g)]
    .map((match) => [Number(match[1]), Number(match[2])])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1])
  if (!versions.length) throw new Error('No glibc version requirements found in the GPUI binary')
  const [major, minor] = versions[0]
  if (major > 2 || (major === 2 && minor > 39))
    throw new Error(
      `GPUI requires glibc ${major}.${minor}; build release packages on Ubuntu 24.04 (glibc 2.39).`,
    )
  return `${major}.${minor}`
}

export async function packageLinux({ archive, stage, output, version, nightly, arch }) {
  requiredGlibc(
    execFileSync('readelf', ['--version-info', join(archive, 'dovo-desktop-gpui')], {
      encoding: 'utf8',
    }),
  )
  const name = 'dovo-studio-gpui'
  const destination = `/opt/${name}`
  const tree = join(stage, 'linux')
  await cp(archive, join(tree, destination), { recursive: true, verbatimSymlinks: true })
  const launcher = join(tree, 'usr/share/applications')
  const icons = join(tree, 'usr/share/icons/hicolor/1024x1024/apps')
  await mkdir(launcher, { recursive: true })
  await mkdir(icons, { recursive: true })
  await writeFile(
    join(launcher, 'dev.dovo.studio.gpui.desktop'),
    desktopEntry(`${destination}/dovo-desktop-gpui`),
  )
  await cp(join(archive, 'dovo-gpui.png'), join(icons, 'dev.dovo.studio.gpui.png'))
  await mkdir(join(tree, 'usr/bin'), { recursive: true })
  await writeFile(
    join(tree, 'usr/bin/dovo-studio-gpui'),
    `#!/bin/sh\nexec ${destination}/dovo-desktop-gpui "$@"\n`,
    { mode: 0o755 },
  )
  for (const format of ['deb', 'rpm']) {
    const packageArch =
      format === 'deb'
        ? arch === 'x64'
          ? 'amd64'
          : 'arm64'
        : arch === 'x64'
          ? 'x86_64'
          : 'aarch64'
    const path = join(
      output,
      `Dovo-GPUI${nightly ? '-Nightly' : ''}-${version}-linux-${packageArch}.${format}`,
    )
    const args = [
      '-s',
      'dir',
      '-t',
      format,
      '-n',
      name,
      '-v',
      version.replace('-nightly.', '~nightly.'),
      '--architecture',
      packageArch,
      '--maintainer',
      'Dovocode <noreply@github.com>',
      '--description',
      'Native Dovo desktop workbench',
      '--license',
      'UNLICENSED',
      '--url',
      'https://github.com/dovocode/dovo-studio',
      '--force',
      '-p',
      path,
      '-C',
      tree,
      ...linuxDependencies[format].flatMap((dependency) => ['--depends', dependency]),
      // The production closure carries prebuilds for other OSes/architectures. Do not scan
      // those as host dependencies; explicit requirements are tested in clean distro images.
      ...(format === 'rpm' ? ['--rpm-auto-add-directories', '--no-rpm-autoreqprov'] : []),
      '.',
    ]
    execFileSync('fpm', args, { stdio: 'inherit' })
  }
}
