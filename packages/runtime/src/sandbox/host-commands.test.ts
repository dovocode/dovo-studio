/// <reference types="node" />
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vite-plus/test'
import { hostCommandWritable } from './host-commands.js'

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function temp(prefix: string) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  temporary.push(directory)
  return directory
}
function executable(path: string) {
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, 0o755)
}

it('blocks a command file in a writable folder, or a link into one', async () => {
  const checkout = temp('dovo-host-checkout-')
  const safe = temp('dovo-host-safe-')
  const writable = (path: string) => path === checkout || path.startsWith(`${checkout}/`)
  executable(join(checkout, 'agent'))
  executable(join(safe, 'agent'))
  symlinkSync(join(checkout, 'agent'), join(safe, 'linked'))
  expect(await hostCommandWritable(join(checkout, 'agent'), undefined, writable)).toBe(true)
  expect(await hostCommandWritable(join(safe, 'linked'), undefined, writable)).toBe(true)
  expect(await hostCommandWritable(join(safe, 'agent'), undefined, writable)).toBe(false)
  // A missing file in a writable folder: the agent can create it.
  expect(await hostCommandWritable(join(checkout, 'later'), undefined, writable)).toBe(true)
})

it('blocks a bare command when a writable PATH folder comes first or holds it', async () => {
  const checkout = temp('dovo-host-checkout-')
  const bin = temp('dovo-host-bin-')
  mkdirSync(join(checkout, 'bin'))
  const writable = (path: string) => path === checkout || path.startsWith(`${checkout}/`)
  executable(join(bin, 'agent'))
  expect(await hostCommandWritable('agent', bin, writable)).toBe(false)
  expect(await hostCommandWritable('agent', `${join(checkout, 'bin')}:${bin}`, writable)).toBe(true)
  expect(await hostCommandWritable('agent', `${bin}:${join(checkout, 'bin')}`, writable)).toBe(
    false,
  )
  expect(await hostCommandWritable('agent', `relative:${bin}`, writable)).toBe(false)
})
