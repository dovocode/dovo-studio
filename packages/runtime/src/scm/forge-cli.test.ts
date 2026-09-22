import { expect, it } from 'vitest'
import { captureForgeCli, runForgeCli, runForgeCliText } from './forge-cli'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('passes credential-helper text unchanged over stdin and preserves split UTF-8 output', async () => {
  const input = 'protocol=https\nhost=forge.example\n\n'
  const result = await runForgeCliText(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `let input = ''; for await (const chunk of process.stdin) input += chunk;
       if (process.argv.some(arg => arg.includes('host=forge.example'))) process.exit(2);
       process.stdout.write(input);
       const text = Buffer.from('héllo');
       process.stdout.write(text.subarray(0, 2));
       setTimeout(() => process.stdout.write(text.subarray(2)), 10);`,
    ],
    input,
  )
  expect(result).toBe(input + 'héllo')
})

it('retains JSON stdin semantics for existing provider writes', async () => {
  const body = { description: 'line one\nline two', enabled: true }
  const result = await captureForgeCli(
    process.execPath,
    ['--eval', 'process.stdin.pipe(process.stdout); process.stderr.write("diagnostic");'],
    body,
  )
  expect(JSON.parse(result.stdout)).toEqual(body)
  expect(result.stderr).toBe('diagnostic')
})

it('redacts private output when a CLI exits unsuccessfully', async () => {
  await expect(
    runForgeCli(process.execPath, [
      '--eval',
      'process.stdout.write("private-token"); process.stderr.write("private-secret"); process.exitCode = 1;',
    ]),
  ).rejects.toThrow(
    'The source control CLI rejected the request. Check host, login, permissions and submitted fields. Refresh before retrying a write.',
  )
})

it('runs in the selected project checkout with account environment limited to that process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-cli-checkout-'))
  const previous = process.env.GH_TOKEN
  try {
    const output = await runForgeCli(
      process.execPath,
      [
        '--eval',
        'process.stdout.write(JSON.stringify({cwd:process.cwd(),token:process.env.GH_TOKEN}));',
      ],
      undefined,
      directory,
      { GH_TOKEN: 'fixture-selected-token' },
    )
    expect(JSON.parse(output)).toEqual({
      cwd: await realpath(directory),
      token: 'fixture-selected-token',
    })
    expect(process.env.GH_TOKEN).toBe(previous)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
