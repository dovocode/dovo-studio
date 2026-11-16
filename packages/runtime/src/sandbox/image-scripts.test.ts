/// <reference types="node" />
import { execFile } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vite-plus/test'

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function temp(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(directory)
  return directory
}

const run = promisify(execFile)
const script = (name: string) =>
  fileURLToPath(new URL(`../../sandbox/bin/${name}`, import.meta.url))

/** A `mise` stand-in that records its arguments. */
function fakeMise() {
  const directory = temp('dovo-fake-mise-')
  const log = join(directory, 'calls')
  writeFileSync(join(directory, 'mise'), `#!/bin/sh\necho "$PWD|$*" >> ${JSON.stringify(log)}\n`)
  chmodSync(join(directory, 'mise'), 0o755)
  return { path: `${directory}:${process.env.PATH ?? ''}`, log }
}

describe('dovo-prepare-project', () => {
  it('trusts only the checkout files and installs their tools', async () => {
    const mise = fakeMise()
    const checkout = temp('dovo-checkout-')
    writeFileSync(join(checkout, 'mise.toml'), '[tools]\nnode = "22"\n')
    writeFileSync(join(checkout, '.nvmrc'), '22\n')
    mkdirSync(join(checkout, '.config'))
    writeFileSync(join(checkout, '.config', 'mise.toml'), '')
    await run(script('dovo-prepare-project'), [checkout], { env: { PATH: mise.path } })
    expect(readFileSync(mise.log, 'utf8').trim().split('\n')).toEqual([
      expect.stringMatching(new RegExp(`\\|trust ${checkout}/mise.toml$`)),
      expect.stringMatching(new RegExp(`\\|trust ${checkout}/.config/mise.toml$`)),
      `${checkout}|install`,
    ])
  })

  it('does nothing for a checkout without mise or version files', async () => {
    const mise = fakeMise()
    const checkout = temp('dovo-checkout-')
    await run(script('dovo-prepare-project'), [checkout], { env: { PATH: mise.path } })
    expect(() => readFileSync(mise.log, 'utf8')).toThrow(/ENOENT/)
  })
})

it.each([true, false])(
  'links an npm CLI through its bin entry (string bin: %s)',
  async (stringBin) => {
    const root = temp('dovo-npm-link-')
    const packageRoot = join(root, 'tool', 'node_modules', '@example', 'agent')
    mkdirSync(join(packageRoot, 'bin'), { recursive: true })
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ bin: stringBin ? 'bin/cli.js' : { agent: 'bin/cli.js' } }),
    )
    writeFileSync(
      join(packageRoot, 'bin', 'cli.js'),
      '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n',
    )
    // A package directory with the command's name was selected as the executable before the fix.
    const install = join(root, 'tool')
    const node = join(root, 'node')
    mkdirSync(join(node, 'bin'), { recursive: true })
    symlinkSync(process.execPath, join(node, 'bin', 'node'))
    writeFileSync(
      join(root, 'mise'),
      '#!/bin/sh\nif [ "$2" = node@lts ]; then echo "$TEST_NODE"; else echo "$TEST_INSTALL"; fi\n',
      { mode: 0o755 },
    )
    // Redirect only the image's fixed output folder into this test's temporary directory.
    const link = join(root, 'link')
    writeFileSync(
      link,
      readFileSync(script('dovo-link-tool'), 'utf8').replaceAll('/opt/dovo/harness/', `${root}/`),
      { mode: 0o755 },
    )
    await run(link, ['agent', 'npm:@example/agent@1.0.0', 'agent'], {
      env: { PATH: `${root}:${process.env.PATH}`, TEST_NODE: node, TEST_INSTALL: install },
    })
    const result = await run(join(root, 'agent'), ['a quoted argument'])
    expect(JSON.parse(result.stdout)).toEqual(['a quoted argument'])
  },
)
