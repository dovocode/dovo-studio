import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, writeFile, rm, chmod, access } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const revision = '692350def1edea35a616b652255a8be70a168d37'
const archiveHash = '4854e9d73e49f36b4cf79f9ddecc78cd07ea2bb574b879c29e2e565bf4a72e3c'
const licenses = [
  ['LICENSE', 'LICENSE.transcribe'],
  ['THIRD-PARTY-LICENSES.md', 'THIRD-PARTY-LICENSES.md'],
  ['ggml/LICENSE', 'LICENSE.ggml'],
  ['src/third_party/miniz/LICENSE', 'LICENSE.miniz'],
]
// Compiler and SDK selection that changes the emitted binary without changing any source file.
const toolchainEnvironment = [
  'CC',
  'CXX',
  'CFLAGS',
  'CXXFLAGS',
  'LDFLAGS',
  'CMAKE_GENERATOR',
  'CMAKE_TOOLCHAIN_FILE',
  'DEVELOPER_DIR',
  'SDKROOT',
  'MACOSX_DEPLOYMENT_TARGET',
  'VCToolsVersion',
  'WindowsSDKVersion',
]

function toolOutput(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    }).trim()
  } catch {
    return `${command} unavailable`
  }
}

/** Identify the compilers CMake will select, so runner image updates rebuild the engine. */
export function dictationToolchain(platform = process.platform) {
  const toolchain = { cmake: toolOutput('cmake', ['--version']).split('\n')[0] }
  if (platform === 'win32') {
    const vswhere = join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Microsoft Visual Studio/Installer/vswhere.exe',
    )
    toolchain.msvc = toolOutput(vswhere, [
      '-latest',
      '-products',
      '*',
      '-property',
      'catalog_productDisplayVersion',
    ])
  } else {
    toolchain.cc = toolOutput(process.env.CC || 'cc', ['--version'])
    toolchain.cxx = toolOutput(process.env.CXX || 'c++', ['--version'])
  }
  if (platform === 'darwin') toolchain.sdk = toolOutput('xcrun', ['--show-sdk-version'])
  if (platform === 'linux') toolchain.glibc = process.report.getReport().header.glibcVersionRuntime
  toolchain.environment = Object.fromEntries(
    toolchainEnvironment
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]]),
  )
  return toolchain
}

/** Hash Dovo's bundled notices by relative path, so an added, changed or deleted file rebuilds. */
async function noticesHash(directory) {
  const hash = createHash('sha256')
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort()
  for (const file of files)
    hash
      .update(`${file}\0`)
      .update(await readFile(join(directory, file)))
      .update('\0')
  return hash.digest('hex')
}

/**
 * Fingerprint every build input: pinned upstream source, Dovo's helper and bundled notices,
 * this build recipe (CMake flags, patching and license collection), target platform/architecture
 * and toolchain.
 */
export async function dictationFingerprint(
  root,
  {
    platform = process.platform,
    arch = process.arch,
    toolchain = dictationToolchain(platform),
  } = {},
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        revision,
        archiveHash,
        platform,
        arch,
        helper: createHash('sha256')
          .update(await readFile(join(root, 'apps/desktop/native/dictation.cpp')))
          .digest('hex'),
        notices: await noticesHash(join(root, 'apps/desktop/build/dictation')),
        recipe: createHash('sha256')
          .update(await readFile(fileURLToPath(import.meta.url)))
          .digest('hex'),
        toolchain,
      }),
    )
    .digest('hex')
}

async function cachedBundle(bundle, name, fingerprint) {
  try {
    const manifest = JSON.parse(await readFile(join(bundle, 'build.json'), 'utf8'))
    // Valid JSON can still be null or a scalar; treat any malformed manifest as a miss.
    if (manifest?.fingerprint !== fingerprint) return false
    const binary = await readFile(join(bundle, name))
    if (manifest.sha256 !== createHash('sha256').update(binary).digest('hex')) return false
    // A cache restore must carry every upstream notice, not just the executable.
    for (const file of [...licenses.map(([, to]) => to), 'LICENSE.tinyblas'])
      await access(join(bundle, file))
    return true
  } catch (error) {
    if (error instanceof SyntaxError || error.code === 'ENOENT') return false
    throw error
  }
}

/** Build on the packaging host; never download or execute a third-party binary at runtime. */
export async function prepareDictationEngine(root) {
  const directory = join(root, 'work/dictation', `${process.platform}-${process.arch}`)
  const bundle = join(directory, 'bundle')
  const helper = join(root, 'apps/desktop/native/dictation.cpp')
  const name = process.platform === 'win32' ? 'dovo-dictation.exe' : 'dovo-dictation'
  const fingerprint = await dictationFingerprint(root)
  if (await cachedBundle(bundle, name, fingerprint)) {
    await cp(join(root, 'apps/desktop/build/dictation'), bundle, { recursive: true })
    return bundle
  }
  const source = join(directory, `transcribe.cpp-${revision}`),
    build = join(directory, 'native-build')
  // Never mix a stale binary, notices or CMake compiler cache into a fresh build.
  for (const path of [bundle, source, build]) await rm(path, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  const response = await fetch(
    `https://codeload.github.com/NairoDorian/transcribe.cpp/tar.gz/${revision}`,
    { signal: AbortSignal.timeout(120_000) },
  )
  if (!response.ok) throw new Error(`Dictation source download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== archiveHash)
    throw new Error('Dictation source integrity check failed.')
  const archive = join(directory, 'source.tar.gz')
  await writeFile(archive, bytes)
  execFileSync('tar', ['-xzf', archive, '-C', directory], { stdio: 'inherit' })
  // Add Dovo's pipe consumer to the extracted, integrity-checked upstream project.
  const cmakePath = (path) => path.replaceAll('\\', '/')
  const cmake = join(source, 'CMakeLists.txt')
  await writeFile(
    cmake,
    (await readFile(cmake, 'utf8')) +
      `
add_executable(dovo-dictation "${cmakePath(helper)}")
target_link_libraries(dovo-dictation PRIVATE transcribe)
set_target_properties(dovo-dictation PROPERTIES CXX_STANDARD 17)
`,
  )
  execFileSync(
    'cmake',
    [
      '-S',
      source,
      '-B',
      build,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DTRANSCRIBE_MODEL_SET=custom',
      '-DTRANSCRIBE_MODELS=parakeet',
      '-DTRANSCRIBE_BUILD_SHARED=OFF',
      '-DTRANSCRIBE_USE_SYSTEM_BLAS=OFF',
      '-DTRANSCRIBE_BUILD_TESTS=OFF',
      '-DTRANSCRIBE_X86_CONSERVATIVE=ON',
      // MSVC ARM cannot configure GGML_NATIVE=OFF. Enable that code path while
      // fixing its feature probes to baseline ARM64, so release binaries don't
      // inherit optional instructions from the build machine's CPU.
      ...(process.platform === 'win32' && process.arch === 'arm64'
        ? [
            '-DGGML_NATIVE=ON',
            '-DGGML_MACHINE_SUPPORTS_dotprod=OFF',
            '-DGGML_MACHINE_SUPPORTS_i8mm=OFF',
            '-DGGML_MACHINE_SUPPORTS_sve=OFF',
            '-DGGML_MACHINE_SUPPORTS_sme=OFF',
            '-DGGML_MACHINE_SUPPORTS_fma=ON',
          ]
        : ['-DGGML_NATIVE=OFF']),
      '-DGGML_METAL_EMBED_LIBRARY=ON',
      '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
    ],
    { stdio: 'inherit' },
  )
  execFileSync(
    'cmake',
    [
      '--build',
      build,
      '--config',
      'Release',
      '--target',
      'dovo-dictation',
      '--parallel',
      String(availableParallelism()),
    ],
    { stdio: 'inherit' },
  )
  await mkdir(bundle, { recursive: true })
  await cp(
    join(build, 'bin', ...(process.platform === 'win32' ? ['Release'] : []), name),
    join(bundle, name),
  )
  await chmod(join(bundle, name), 0o755)
  for (const [from, to] of licenses) await cp(join(source, from), join(bundle, to))
  await cp(join(root, 'apps/desktop/build/dictation'), bundle, { recursive: true })
  const tinyblas = await readFile(join(source, 'ggml/src/ggml-cpu/llamafile/sgemm.cpp'), 'utf8')
  await writeFile(
    join(bundle, 'LICENSE.tinyblas'),
    tinyblas.split('\n\n')[0].replace(/^\/\/ ?/gm, '') + '\n',
  )
  await writeFile(
    join(bundle, 'build.json'),
    JSON.stringify({
      revision,
      fingerprint,
      sha256: createHash('sha256')
        .update(await readFile(join(bundle, name)))
        .digest('hex'),
    }),
  )
  await rm(archive)
  return bundle
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  if (process.argv.includes('--cache-key')) {
    // Exact-match key only: a partial restore would fail the fingerprint check and rebuild anyway.
    const key = `dictation-v1-${process.platform}-${process.arch}-${await dictationFingerprint(root)}`
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `key=${key}\npath=work/dictation/${process.platform}-${process.arch}/bundle\n`,
      )
    console.log(key)
    process.exit(0)
  }
  const bundle = await prepareDictationEngine(root)
  console.log(`Local dictation engine ready: ${bundle}`)
}
