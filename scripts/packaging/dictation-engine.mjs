import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const revision = '692350def1edea35a616b652255a8be70a168d37'
const archiveHash = '4854e9d73e49f36b4cf79f9ddecc78cd07ea2bb574b879c29e2e565bf4a72e3c'

/** Build on the packaging host; never download or execute a third-party binary at runtime. */
export async function prepareDictationEngine(root) {
  const directory = join(root, 'work/dictation', `${process.platform}-${process.arch}`)
  const bundle = join(directory, 'bundle')
  const name = process.platform === 'win32' ? 'transcribe-cli.exe' : 'transcribe-cli'
  try {
    const manifest = JSON.parse(await readFile(join(bundle, 'build.json'), 'utf8'))
    const binary = await readFile(join(bundle, name))
    if (
      manifest.revision === revision &&
      manifest.sha256 === createHash('sha256').update(binary).digest('hex')
    ) {
      await cp(join(root, 'apps/desktop/build/dictation'), bundle, { recursive: true })
      const tinyblas = await readFile(
        join(directory, `transcribe.cpp-${revision}/ggml/src/ggml-cpu/llamafile/sgemm.cpp`),
        'utf8',
      )
      await writeFile(
        join(bundle, 'LICENSE.tinyblas'),
        tinyblas.split('\n\n')[0].replace(/^\/\/ ?/gm, '') + '\n',
      )
      return bundle
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error
  }
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
  const source = join(directory, `transcribe.cpp-${revision}`),
    build = join(directory, 'build')
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
      '-DGGML_NATIVE=OFF',
      '-DGGML_METAL_EMBED_LIBRARY=ON',
      '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
    ],
    { stdio: 'inherit' },
  )
  execFileSync(
    'cmake',
    ['--build', build, '--config', 'Release', '--target', 'transcribe-cli', '--parallel', '4'],
    { stdio: 'inherit' },
  )
  await mkdir(bundle, { recursive: true })
  await cp(
    join(build, 'bin', ...(process.platform === 'win32' ? ['Release'] : []), name),
    join(bundle, name),
  )
  await chmod(join(bundle, name), 0o755)
  for (const [from, to] of [
    ['LICENSE', 'LICENSE.transcribe'],
    ['THIRD-PARTY-LICENSES.md', 'THIRD-PARTY-LICENSES.md'],
    ['ggml/LICENSE', 'LICENSE.ggml'],
    ['src/third_party/miniz/LICENSE', 'LICENSE.miniz'],
  ])
    await cp(join(source, from), join(bundle, to))
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
      sha256: createHash('sha256')
        .update(await readFile(join(bundle, name)))
        .digest('hex'),
    }),
  )
  await rm(archive)
  return bundle
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = await prepareDictationEngine(
    resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  )
  console.log(`Local dictation engine ready: ${bundle}`)
}
