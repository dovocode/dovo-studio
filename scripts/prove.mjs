// Proves that tests catch a bug: they must fail on the base commit and pass on this checkout.
// The base runs in a temporary git worktree. The user's working tree, index and stash stay as
// they are; only the given files are copied into the temporary worktree.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

const USAGE = `Usage: pnpm prove -- [--base <ref>] [--build] <files...>

Runs the given test files on the merge-base of HEAD and <ref> (default: main), then on
this checkout. The proof holds when the tests fail on the base and pass here.

  --base <ref>  Branch, tag or commit to compare with. Default: main.
  --build       Build @dovo/api and its workspace dependencies in the base worktree
                first, for tests that import compiled package output.

Pass test helpers or fixtures too if the tests need them. The script copies every
given file but runs only *.test.* files.

Exit codes: 0 proven, 1 not proven, 2 setup error, 3 a test file could not load on the
base (a missing module or export, or a syntax error), so its failure proves nothing.

The base worktree goes in $DOVO_PROVE_DIR, or ~/.cache/dovo-prove by default. Keep it on the
same disk as the pnpm store so the install can hard-link packages.`

const EXIT = { proven: 0, notProven: 1, setup: 2, notLoaded: 3, interrupted: 130 }
const shell = process.platform === 'win32'

class SetupError extends Error {}
class Interrupted extends Error {}

function parseArguments(argv) {
  /** @type {{ base: string, build: boolean, files: string[] }} */
  const options = { base: 'main', build: false, files: [] }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--help' || argument === '-h') return undefined
    if (argument === '--build') options.build = true
    else if (argument === '--base') {
      options.base = argv[++index]
      if (!options.base) throw new SetupError('--base needs a git ref')
    } else if (argument.startsWith('-')) throw new SetupError(`Unknown option ${argument}`)
    else options.files.push(argument)
  }
  if (!options.files.length) throw new SetupError('Give at least one test file')
  return options
}

/** Chooses the runner for a test file, or undefined for helper files that are only copied. */
export function testRunner(path) {
  if (/\.test\.[cm]?js$/.test(path)) return 'node'
  if (/\.test\.[cm]?tsx?$/.test(path)) return 'vitest'
  return undefined
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Finds test files that failed before any test ran: a missing module or export, a syntax error
 * or an error at the top level of the file. Such a failure does not show that a test catches
 * the bug. `output` is the runner output without color codes.
 */
export function unloadedFiles(runner, files, output) {
  return files.filter((file) => {
    const name = escapeRegExp(file)
    // node:test reports a file that fails outside its tests as a test named after the file.
    if (runner === 'node') return new RegExp(`^\\s*✖ ${name} \\(`, 'm').test(output)
    // Vitest marks a file-level failure as `FAIL  <file> [ <file> ]`.
    return new RegExp(`FAIL\\s+${name} \\[ ${name} \\]`).test(output)
  })
}

const runnerCommand = (runner, files) =>
  runner === 'node'
    ? [process.execPath, ['--test', ...files]]
    : ['pnpm', ['exec', 'vp', 'test', 'run', ...files]]

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

// The default sits next to pnpm's default store in the home folder, so pnpm can hard-link packages
// instead of copying them. Not in .git: TypeScript skips paths with "/.git" when it writes
// declaration imports, so package builds there fail. Not in /tmp: it is often a separate tmpfs.
const proveDirectory = () =>
  process.env.DOVO_PROVE_DIR ??
  join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'dovo-prove')

// pnpm runs root scripts from the repository root; INIT_CWD keeps paths relative to the caller.
const callerDirectory = () => process.env.INIT_CWD ?? process.cwd()

export async function prove(argv, { cwd = callerDirectory(), log = console.log } = {}) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    if (!(error instanceof SetupError)) throw error
    console.error(`${error.message}\n\n${USAGE}`)
    return EXIT.setup
  }
  if (!options) {
    log(USAGE)
    return EXIT.proven
  }

  let worktree
  let adminDirectory
  let child
  let interrupted = false

  const removeWorktree = () => {
    if (!worktree) return
    const directory = worktree
    worktree = undefined
    const removed = spawnSync('git', ['worktree', 'remove', '--force', directory], {
      cwd,
      stdio: 'ignore',
    })
    // If git cannot remove it, delete the folder and its admin entry, but no other worktree.
    if (removed.status !== 0 && adminDirectory)
      rmSync(adminDirectory, { recursive: true, force: true })
    rmSync(directory, { recursive: true, force: true })
  }
  const onSignal = (signal) => {
    if (interrupted) {
      removeWorktree()
      process.exit(EXIT.interrupted)
    }
    interrupted = true
    log(`\nprove: ${signal} received, stopping and removing the base worktree...`)
    child?.kill('SIGTERM')
  }
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
  for (const signal of signals) process.on(signal, onSignal)
  process.on('exit', removeWorktree)

  // Streams output and keeps the end of it, so a base run without tests is not taken as proof.
  const run = (command, args, directory, { quiet = false } = {}) =>
    new Promise((resolvePromise, reject) => {
      if (interrupted) return reject(new Interrupted())
      let tail = ''
      // A parent node:test run would make a nested `node --test` skip every file.
      const { NODE_TEST_CONTEXT: _parentTest, ...env } = process.env
      child = spawn(command, args, {
        cwd: directory,
        shell,
        env: { ...env, ...(process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const collect = (stream) => (chunk) => {
        tail = (tail + chunk).slice(-200_000)
        if (!quiet) stream.write(chunk)
      }
      child.stdout.on('data', collect(process.stdout))
      child.stderr.on('data', collect(process.stderr))
      child.on('error', reject)
      child.on('close', (code, signal) => {
        child = undefined
        if (interrupted) reject(new Interrupted())
        else resolvePromise({ code: code ?? (signal ? 1 : 0), tail })
      })
    })

  const runTests = async (directory, groups) => {
    let failed = false
    let ranTests = true
    const unloaded = []
    for (const [runner, files] of groups) {
      const [command, args] = runnerCommand(runner, files)
      const { code, tail } = await run(command, args, directory)
      if (code !== 0) failed = true
      const plain = stripVTControlCharacters(tail)
      if (/No test files found|^ℹ tests 0$/m.test(plain)) ranTests = false
      if (code !== 0) unloaded.push(...unloadedFiles(runner, files, plain))
    }
    return { failed, ranTests, unloaded }
  }

  try {
    const root = git(cwd, 'rev-parse', '--show-toplevel')
    const files = options.files.map((file) => {
      const path = relative(root, resolve(cwd, file))
      if (path.startsWith('..') || isAbsolute(path))
        throw new SetupError(`${file} is outside the repository`)
      if (!existsSync(join(root, path))) throw new SetupError(`${file} does not exist`)
      return path.split('\\').join('/')
    })
    const groups = new Map()
    for (const file of files) {
      const runner = testRunner(file)
      if (runner) groups.set(runner, [...(groups.get(runner) ?? []), file])
    }
    if (!groups.size) throw new SetupError('None of the files is a *.test.* file')

    let mergeBase
    try {
      mergeBase = git(root, 'merge-base', 'HEAD', options.base)
    } catch {
      throw new SetupError(`Cannot find a merge-base of HEAD and ${options.base}`)
    }
    const head = git(root, 'rev-parse', 'HEAD')
    const short = mergeBase.slice(0, 10)
    if (mergeBase === head)
      log('prove: the base is HEAD itself, so only uncommitted changes differ from it.')

    const parent = proveDirectory()
    mkdirSync(parent, { recursive: true })
    worktree = mkdtempSync(join(parent, `${basename(root)}-`))
    log(`prove: creating a base worktree at ${short} in ${worktree}`)
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree, mergeBase], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    adminDirectory = git(worktree, 'rev-parse', '--path-format=absolute', '--git-dir')
    for (const file of files) {
      mkdirSync(dirname(join(worktree, file)), { recursive: true })
      copyFileSync(join(root, file), join(worktree, file))
    }

    // Workspace links in node_modules are relative. A symlink to this checkout's node_modules
    // would resolve @dovo/* packages to this checkout's sources, so install the base's own
    // dependency tree. pnpm hard-links from the shared store, which is fast when it is warm.
    log('prove: installing base dependencies from the pnpm store...')
    const install = await run(
      'pnpm',
      ['install', '--frozen-lockfile', '--prefer-offline'],
      worktree,
      { quiet: true },
    )
    if (install.code !== 0) {
      process.stderr.write(install.tail.slice(-4000))
      throw new SetupError('pnpm install failed in the base worktree')
    }
    if (options.build) {
      log('prove: building @dovo/api and its workspace dependencies in the base worktree...')
      const build = await run('pnpm', ['--filter', '@dovo/api...', '-r', 'build'], worktree, {
        quiet: true,
      })
      if (build.code !== 0) {
        process.stderr.write(build.tail.slice(-4000))
        throw new SetupError('The base build failed')
      }
    }

    log(`\nprove: running tests on the base (${short}), expecting failure\n`)
    const base = await runTests(worktree, groups)
    if (interrupted) throw new Interrupted()
    removeWorktree()
    if (!base.ranTests)
      throw new SetupError(
        'The base run found no tests. Check that the base test config includes these files.',
      )

    log('\nprove: running tests on this checkout, expecting success\n')
    const current = await runTests(root, groups)
    if (interrupted) throw new Interrupted()

    const loaded = !base.unloaded.length
    const proven = base.failed && !current.failed && current.ranTests
    log('\nprove: result')
    log(
      `  base ${short} (merge-base with ${options.base}): ${
        !loaded
          ? `could not load ${base.unloaded.join(', ')}`
          : base.failed
            ? 'failed, as expected'
            : 'passed, but it should fail'
      }`,
    )
    log(
      `  this checkout: ${current.failed ? 'failed, but it should pass' : current.ranTests ? 'passed, as expected' : 'ran no tests'}`,
    )
    if (!loaded) {
      log(
        'Not proven: the test could not load on the base. A missing module or export, or a syntax error, fails every test before it runs. Make the test import only code that exists on the base, or prove it with a test that does.',
      )
      return EXIT.notLoaded
    }
    log(
      proven
        ? 'Proven: the tests fail on the base and pass on this checkout.'
        : 'Not proven. Read the output above.',
    )
    return proven ? EXIT.proven : EXIT.notProven
  } catch (error) {
    if (error instanceof Interrupted) return EXIT.interrupted
    if (error instanceof SetupError) {
      console.error(`prove: ${error.message}`)
      return EXIT.setup
    }
    throw error
  } finally {
    removeWorktree()
    process.off('exit', removeWorktree)
    for (const signal of signals) process.off(signal, onSignal)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await prove(process.argv.slice(2))
}
