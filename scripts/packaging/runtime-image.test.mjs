import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const { parse } = createRequire(new URL('packages/runtime/package.json', root))('yaml')
const workflow = async (name) =>
  parse(await readFile(new URL(`.github/workflows/${name}.yml`, root), 'utf8'))

void test('the runtime image uses the repository Node version in every stage', async () => {
  const node = (await readFile(new URL('.node-version', root), 'utf8')).trim()
  const dockerfile = await readFile(new URL('apps/api/Dockerfile', root), 'utf8')
  const images = [...dockerfile.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/gm)].map(
    (match) => match[1],
  )
  assert.ok(images.length >= 2)
  // The archive brings its own Node; the base Node runs npm-installed agent CLIs and health checks.
  for (const image of images) assert.equal(image, `node:${node}-trixie-slim`)
})

void test('runtime image CI builds and smokes both architectures on native runners', async () => {
  const { jobs } = await workflow('runtime-image')
  assert.deepEqual(jobs.image.strategy.matrix.include, [
    { architecture: 'amd64', runner: 'ubuntu-24.04' },
    { architecture: 'arm64', runner: 'ubuntu-24.04-arm' },
  ])
  const build = jobs.image.steps.find(
    (step) => step.name === 'Build native Linux image without pushing',
  )
  assert.match(build.with.platforms, /matrix.architecture/)
  const smoke = jobs.image.steps.find(
    (step) => step.name === 'Check health, pairing and persisted draft',
  )
  assert.match(smoke.run, /runtime-image-smoke\.mjs dovo-server:ci "\$PREVIOUS_IMAGE"/)
})

void test('verified historical tags without a Dockerfile only backfill package metadata', async () => {
  const { jobs } = await workflow('distribution')
  const source = jobs.container.steps.find(({ id }) => id === 'source')
  assert.ok(source)
  const checkout = jobs.container.steps.find(({ with: inputs }) =>
    inputs?.ref?.includes('source.outputs.revision'),
  )
  for (const step of [
    checkout,
    ...jobs.container.steps.filter(
      (step) => step.uses?.startsWith('docker/') || step.name?.startsWith('Check health'),
    ),
  ])
    assert.equal(step.if, "steps.source.outputs.container == 'true'")

  const directory = await mkdtemp(join(tmpdir(), 'dovo-container-eligibility-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
    git('init', '--quiet')
    git('config', 'user.name', 'Container fixture')
    git('config', 'user.email', 'container@example.test')
    git('commit', '--quiet', '--allow-empty', '-m', 'Pre-container archive release')
    const old = git('rev-parse', 'HEAD')
    await mkdir(join(directory, 'apps/api'), { recursive: true })
    await writeFile(join(directory, 'apps/api/Dockerfile'), 'FROM scratch\n')
    git('add', 'apps/api/Dockerfile')
    git('commit', '--quiet', '-m', 'Container archive release')
    const current = git('rev-parse', 'HEAD')
    git('remote', 'add', 'origin', directory)
    await writeFile(join(directory, 'node'), '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_REVISION"\n', {
      mode: 0o700,
    })
    await writeFile(join(directory, 'gh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    const output = join(directory, 'output')
    const sourceStep = async (revision, tag) => {
      await writeFile(output, '')
      const stdout = execFileSync('bash', ['-euo', 'pipefail', '-c', source.run], {
        cwd: directory,
        env: {
          PATH: directory + delimiter + process.env.PATH,
          HOME: directory,
          FIXTURE_REVISION: revision,
          TAG: tag,
          GITHUB_OUTPUT: output,
        },
        encoding: 'utf8',
      })
      return { stdout, output: await readFile(output, 'utf8') }
    }
    const legacy = await sourceStep(old, 'v0.0.8')
    assert.match(legacy.stdout, /predates the runtime container/)
    assert.equal(legacy.output.trim(), `revision=${old}`)
    const currentRelease = await sourceStep(current, 'v0.0.9')
    assert.equal(currentRelease.output.trim(), `revision=${current}\ncontainer=true`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
