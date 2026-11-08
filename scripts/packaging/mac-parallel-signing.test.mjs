import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { setImmediate } from 'node:timers/promises'
import { configureMacSigning } from './mac-parallel-signing.mjs'

const builder = createRequire(createRequire(import.meta.url).resolve('electron-builder'))
const packager = createRequire(builder.resolve('app-builder-lib'))
const signer = createRequire(packager.resolve('@electron/osx-sign'))
const { signAsync } = signer('./index.js')
const transport = signer('./util.js')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dovo-parallel-sign-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'Dovo Test.app')
  const framework = join(app, 'Contents/Frameworks/Native.framework')
  const helper = join(app, 'Contents/Frameworks/Helper.app')
  const frameworkBinary = join(framework, 'Versions/A/Native')
  const main = join(app, 'Contents/MacOS/Main')
  const helperBinary = join(helper, 'Contents/MacOS/Helper')
  const ignored = join(app, 'Contents/MacOS/ignored')
  const parallel = Array.from({ length: 8 }, (_, i) =>
    join(app, `Contents/Resources/runtime/node_modules/pkg/bin/native-${i}`),
  )
  const binaries = [frameworkBinary, main, helperBinary, ignored, ...parallel]
  for (const path of binaries) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from([0, 1, 2, 3]))
  }
  await symlink('A', join(framework, 'Versions/Current'))
  await symlink('Versions/Current/Native', join(framework, 'Native'))
  const alias = join(root, 'Alias.app')
  await symlink(app, alias)
  return {
    root,
    app,
    alias,
    framework,
    frameworkBinary,
    helper,
    helperBinary,
    main,
    ignored,
    parallel,
  }
}

function options(f) {
  return {
    app: f.app,
    platform: 'darwin',
    identity: 'Developer ID Application: Fixture (FIXTURE)',
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    signingConcurrency: 4,
    keychain: '/fixture/signing.keychain',
    binaries: [f.parallel[0], join(f.framework, 'Native'), f.app, f.alias],
    ignore: (file) => file.includes('ignored'),
    optionsForFile: (file) => ({
      entitlements: file === f.app ? '/fixture/main.plist' : '/fixture/inherit.plist',
      hardenedRuntime: true,
      timestamp: 'https://fixture.invalid/timestamp',
      requirements: '=designated => anchor apple generic',
      additionalArguments: ['--verbose=2'],
    }),
  }
}

await test('installed signer bounds concurrency, isolates bundle executables and signs children before parents', async (t) => {
  const f = await fixture(t)
  const opts = options(f)
  const canonicalPaths = new Map(
    await Promise.all(
      [...(await transport.walkAsync(join(f.app, 'Contents'))), f.app, ...opts.binaries].map(
        async (file) => [file, await realpath(file)],
      ),
    ),
  )
  // Ignored missing binaries must not become realpath errors in the parallel scheduler.
  opts.binaries.push(join(f.root, 'missing-ignored'))
  opts.ignore = (file) => file.includes('missing-ignored')
  const expected = new Set(
    await Promise.all(
      [
        f.app,
        f.framework,
        f.frameworkBinary,
        f.helper,
        f.helperBinary,
        f.main,
        f.ignored,
        ...f.parallel,
      ].map((p) => realpath(p)),
    ),
  )
  const active = new Set()
  const finished = new Set()
  const commands = []
  let peak = 0
  const execute = mock.method(transport, 'execFileAsync', async (command, args) => {
    assert.equal(command, 'codesign')
    commands.push(args)
    if (args.includes('--sign')) {
      const file = args.at(-1)
      const canonical = canonicalPaths.get(file)
      assert.ok(expected.has(canonical), file)
      assert.ok(!active.has(canonical) && !finished.has(canonical), `Duplicate: ${file}`)
      const bundleExecutables = [f.main, f.helperBinary, f.ignored].map((file) =>
        canonicalPaths.get(file),
      )
      if (bundleExecutables.includes(canonical))
        assert.equal(active.size, 0, 'Bundle executables must not inspect temporary signing files')
      for (const executable of bundleExecutables)
        assert.ok(!active.has(executable), 'Bundle executable signing must remain isolated')
      for (const child of expected) {
        if (child.startsWith(canonical + sep))
          assert.ok(finished.has(child), `${child} before ${file}`)
      }
      if (file === f.app) assert.equal(finished.size, expected.size - 1)
      active.add(canonical)
      peak = Math.max(peak, active.size)
      assert.ok(active.size <= 4)
      assert.deepEqual(args.slice(0, 5), [
        '--sign',
        opts.identity,
        '--force',
        '--keychain',
        opts.keychain,
      ])
      assert.ok(args.includes('--timestamp=https://fixture.invalid/timestamp'))
      assert.ok(args.includes('-r=designated => anchor apple generic'))
      assert.equal(
        args[args.indexOf('--entitlements') + 1],
        file === f.app ? '/fixture/main.plist' : '/fixture/inherit.plist',
      )
      if (process.platform === 'darwin') assert.ok(args.includes('runtime'))
      await setImmediate()
      active.delete(canonical)
      finished.add(canonical)
    } else {
      assert.equal(active.size, 0)
      assert.deepEqual(finished, expected)
      if (args.includes('--verify')) {
        assert.ok(args.includes('--deep'))
        if (process.platform === 'darwin') assert.ok(args.includes('--strict'))
      }
    }
    return ''
  })
  t.after(() => execute.mock.restore())
  await signAsync(opts)
  assert.equal(peak, 4)
  assert.equal(commands.filter((args) => args.includes('--verify')).length, 1)
  assert.ok(commands.at(-1).includes('--display'))
})

await test('failed signatures stop new work and drain active tasks before rejecting', async (t) => {
  const f = await fixture(t)
  const failure = new Error('timestamp service failed')
  const started = []
  const allStarted = Promise.withResolvers()
  const fail = Promise.withResolvers()
  const drain = Promise.withResolvers()
  let active = 0
  const execute = mock.method(transport, 'execFileAsync', async (_command, args) => {
    assert.ok(args.includes('--sign'), 'Failure must prevent verification')
    const index = started.push(args.at(-1))
    active++
    if (index === 4) allStarted.resolve()
    try {
      if (index === 1) {
        await fail.promise
        throw failure
      }
      await drain.promise
    } finally {
      active--
    }
    return ''
  })
  t.after(() => execute.mock.restore())
  let settled = false
  const signing = signAsync(options(f))
  const outcome = signing.then(
    () => {
      settled = true
      return undefined
    },
    (error) => {
      settled = true
      return error
    },
  )
  try {
    await allStarted.promise
    fail.resolve()
    await setImmediate()
    assert.equal(active, 3)
    assert.equal(settled, false)
    assert.equal(started.length, 4)
  } finally {
    fail.resolve()
    drain.resolve()
  }
  assert.equal(await outcome, failure)
  assert.equal(active, 0)
  assert.equal(started.length, 4, 'No remaining siblings or enclosing bundles may start')
})

await test('default signer remains sequential', async (t) => {
  const f = await fixture(t)
  const opts = options(f)
  delete opts.signingConcurrency
  let active = 0
  let peak = 0
  const execute = mock.method(transport, 'execFileAsync', async () => {
    active++
    peak = Math.max(peak, active)
    await setImmediate()
    active--
    return ''
  })
  t.after(() => execute.mock.restore())
  await signAsync(opts)
  assert.equal(peak, 1)
})

await test('rejects invalid concurrency before starting any signing', async () => {
  for (const signingConcurrency of [0, -1, 1.5, NaN, Infinity, '4', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(signAsync({ signingConcurrency }), /positive safe integer/)
  }
})

await test('desktop opt-in preserves installed builder identity resolution, options and failures', async (t) => {
  builder('app-builder-lib')
  const { MacPackager } = builder('app-builder-lib/out/macPackager.js')
  const signing = builder('app-builder-lib/out/codeSign/macCodeSign.js')
  const identity = { name: 'Developer ID Application: Fixture (FIXTURE)', hash: 'fixture-hash' }
  const opts = { app: '/fixture/Dovo.app', identity: identity.hash, keychain: '/fixture/keychain' }
  const failure = new Error('signing failed')
  let attempt = 0
  const execute = mock.method(signing, 'sign', async (received) => {
    assert.deepEqual(received, { ...opts, identity: identity.name, signingConcurrency: 4 })
    if (attempt++) throw failure
    return 'signed'
  })
  t.after(() => execute.mock.restore())
  const instance = {
    appInfo: { type: 'module' },
    info: { getWorkspaceRoot: async () => process.cwd() },
    doSign: MacPackager.prototype.doSign,
  }
  configureMacSigning(instance)
  assert.equal(await instance.doSign(opts, {}, identity), 'signed')
  await assert.rejects(instance.doSign(opts, {}, identity), (error) => error === failure)
  assert.equal(opts.identity, identity.hash, 'Do not mutate the builder options')
})

await test(
  'macOS signs and strictly verifies a real nested bundle with framework aliases',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const f = await fixture(t)
    const source = join(f.root, 'main.c')
    const executable = join(f.root, 'native')
    await writeFile(source, 'int main(void) { return 0; }\n')
    execFileSync('xcrun', ['clang', source, '-o', executable])
    for (const file of [f.main, f.helperBinary, f.ignored, ...f.parallel])
      await cp(executable, file)
    execFileSync('xcrun', ['clang', '-dynamiclib', source, '-o', f.frameworkBinary])
    for (const [bundle, name, binary, kind] of [
      [f.app, 'DovoTest', 'Main', 'APPL'],
      [f.helper, 'Helper', 'Helper', 'APPL'],
      [join(f.framework, 'Versions/A'), 'Native', 'Native', 'FMWK'],
    ]) {
      const contents = kind === 'APPL' ? join(bundle, 'Contents') : join(bundle, 'Resources')
      await mkdir(contents, { recursive: true })
      await writeFile(
        join(contents, 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.dovo.signing-test.${name}</string>
<key>CFBundleExecutable</key><string>${binary}</string>
<key>CFBundlePackageType</key><string>${kind}</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>\n`,
      )
    }
    await symlink('Versions/Current/Resources', join(f.framework, 'Resources'))
    await signAsync({
      ...options(f),
      identity: '-',
      keychain: undefined,
      ignore: undefined,
      optionsForFile: () => ({ hardenedRuntime: true, timestamp: 'none' }),
    })
    for (const bundle of [f.helper, f.framework, f.app]) {
      execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle])
    }
    assert.equal(execFileSync(f.main).length, 0)
  },
)
