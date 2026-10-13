import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const dependencies = JSON.parse(await readFile(join(directory, 'linux-dependencies.json'), 'utf8'))
let failed = false
try {
  const linked = execFileSync('ldd', [join(directory, 'dovo-desktop-gpui')], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (/not found/.test(linked)) {
    console.error(linked)
    failed = true
  }
  const cache = execFileSync('/sbin/ldconfig', ['-p'], { encoding: 'utf8' })
  for (const library of ['libvulkan.so.1', 'libfontconfig.so.1']) {
    if (!cache.includes(library)) {
      console.error(`Missing dynamically loaded library: ${library}`)
      failed = true
    }
  }
  execFileSync('fc-match', ['sans-serif'], { stdio: 'inherit' })
} catch (error) {
  console.error(error.stderr?.toString() || error.message)
  failed = true
}
if (failed) {
  console.error(
    'Install the RPM with dnf (Fedora) or the DEB with apt (Ubuntu/Debian) to resolve dependencies automatically.',
  )
  console.error(
    `Fedora archive dependencies: sudo dnf install ${dependencies.rpm.map((name) => name.split(' ')[0]).join(' ')}`,
  )
  console.error(
    'A working Vulkan GPU driver, X11/XWayland and a desktop Secret Service are also required. An old archive may require rebuilding against an older glibc.',
  )
  process.exitCode = 1
} else {
  console.log(
    'Linked libraries, Vulkan loader, fontconfig and system font are present. This check does not validate the GPU driver or desktop session.',
  )
}
