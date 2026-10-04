import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { hermesExecutable, hermesLaunch } from './hermes-launch.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
async function installation() {
  const home = await mkdtemp(join(tmpdir(), 'dovo-hermes-launch-'))
  directories.push(home)
  const bin = join(home, '.local', 'bin')
  await mkdir(bin, { recursive: true })
  const command = join(bin, process.platform === 'win32' ? 'hermes.exe' : 'hermes')
  await writeFile(command, '#!/bin/sh\n# Modern launcher\n', { mode: 0o755 })
  return { home, bin, command }
}
it('finds Hermes outside a service PATH and gives PATH installations precedence', async () => {
  const local = await installation(),
    other = await installation()
  expect(hermesExecutable('hermes', { HOME: local.home, PATH: join(local.home, 'missing') })).toBe(
    local.command,
  )
  expect(
    hermesExecutable('hermes', { HOME: local.home, PATH: [other.bin, local.bin].join(delimiter) }),
  ).toBe(other.command)
  expect(hermesExecutable('/custom/hermes', { HOME: local.home, PATH: other.bin })).toBe(
    '/custom/hermes',
  )
  expect(hermesExecutable('hermes', { HOME: join(local.home, 'missing'), PATH: '' })).toBe('hermes')
})
it('uses the native bootstrap contract for modern launchers', async () => {
  const { home, command } = await installation()
  expect(
    hermesLaunch({ provider: 'hermes', endpoint: '', model: '', env: { HOME: home, PATH: '' } }),
  ).toMatchObject({
    command,
    args: ['--run-module', 'tui_gateway.entry'],
    env: { PYTHONUNBUFFERED: '1' },
  })
})
it('resolves the old installer shim and pip console script to their own Python', async () => {
  const { home, command } = await installation()
  const python = join(home, 'hermes agent', 'venv', 'bin', 'python')
  const agent = {
    provider: 'hermes' as const,
    endpoint: command,
    model: '',
    env: { PYTHONHOME: '/foreign-python', PYTHONPATH: '/foreign-modules' },
  }
  await writeFile(
    command,
    `#!/usr/bin/env bash\nunset PYTHONPATH\nunset PYTHONHOME\nexec "${python}" "${join(home, 'hermes')}" "$@"\n`,
  )
  expect(hermesLaunch(agent)).toMatchObject({
    command: python,
    args: ['-u', '-P', '-m', 'tui_gateway.entry'],
    env: { PYTHONHOME: '', PYTHONPATH: '' },
  })
  expect(
    hermesLaunch({ ...agent, env: { ...agent.env, HERMES_PYTHON_SRC_ROOT: '/source' } }).env,
  ).toMatchObject({ PYTHONHOME: '', PYTHONPATH: '/source' })
  await writeFile(command, `#!${python}\nfrom hermes_cli.main import main\n`)
  expect(hermesLaunch(agent).command).toBe(python)
  await writeFile(command, '#!/bin/sh\nexec "$HERMES_PYTHON" "$HERMES_ENTRYPOINT" "$@"\n')
  expect(hermesLaunch(agent).command).toBe(command)
})
it('preserves Python overrides, source roots and explicit custom launch arguments', async () => {
  const { command } = await installation()
  const agent = {
    provider: 'hermes' as const,
    endpoint: '',
    model: '',
    env: { HERMES_PYTHON: '/custom/interpreter', HERMES_PYTHON_SRC_ROOT: '/source' },
  }
  expect(hermesLaunch(agent)).toMatchObject({
    command: '/custom/interpreter',
    args: ['-u', '-P', '-m', 'tui_gateway.entry'],
    env: { PYTHONPATH: '/source' },
  })
  expect(hermesLaunch({ ...agent, endpoint: '/custom/python3.11' }).args).toEqual([
    '-u',
    '-P',
    '-m',
    'tui_gateway.entry',
  ])
  await writeFile(command, '#!/bin/sh\nexec "/old/bin/python" "/old/hermes" "$@"\n')
  expect(hermesLaunch({ ...agent, endpoint: command, args: ['custom-gateway'] })).toMatchObject({
    command,
    args: ['custom-gateway'],
  })
})
