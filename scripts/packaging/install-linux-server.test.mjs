import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const installer = new URL('../install-linux-server.sh', import.meta.url).pathname

/** @type {Array<[string, Record<string, string>, string | undefined, string | undefined]>} */
const cases = [
  [
    'GH_TOKEN takes precedence',
    { GH_TOKEN: 'gh_explicit', GITHUB_TOKEN: 'github_explicit' },
    'gh_cli',
    'gh_explicit',
  ],
  [
    'GITHUB_TOKEN takes precedence over gh',
    { GITHUB_TOKEN: 'github_explicit' },
    'gh_cli',
    'github_explicit',
  ],
  ['existing gh login', {}, 'gh_cli', 'gh_cli'],
  ['existing gh login for Nightly', {}, 'gh_cli', 'gh_cli'],
  ['failed gh lookup', {}, undefined, undefined],
  ['missing gh CLI', {}, undefined, undefined],
  ['empty gh output', {}, '', undefined],
  ['malformed gh output', {}, 'token\nAuthorization: injected', undefined],
]
for (const [name, credentials, cliToken, expected] of cases) {
  await test(`Linux installation: ${name}`, { skip: process.platform !== 'linux' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-installer-auth-'))
    try {
      const bin = join(directory, 'tools')
      const archiveRoot = join(directory, 'archive-root')
      const nightly = name.includes('Nightly')
      const version = nightly ? '1.2.3-nightly.42' : '1.2.3'
      const launcher = nightly ? 'dovo-server-nightly' : 'dovo-server'
      await mkdir(bin)
      await mkdir(join(archiveRoot, 'bin'), { recursive: true })
      await writeFile(join(archiveRoot, 'bin', launcher), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      const archive = join(directory, 'server.tar.gz')
      execFileSync('tar', ['-czf', archive, '-C', archiveRoot, '.'])
      const bytes = await readFile(archive)
      const assetName = `Dovo-Server${nightly ? '-Nightly' : ''}-${version}-linux-x64.tar.gz`
      const release = {
        tag_name: `v${version}`,
        draft: false,
        prerelease: nightly,
        assets: [
          {
            name: assetName,
            browser_download_url: `https://github.com/dovocode/dovo-studio/releases/download/v${version}/${assetName}`,
            digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
            size: bytes.length,
          },
        ],
      }
      const log = join(directory, 'requests.jsonl')
      const fixture = join(directory, 'fixture.cjs')
      await writeFile(
        fixture,
        `
const fs = require('node:fs');
const [command, ...args] = process.argv.slice(2);
const config = args.includes('--config') ? fs.readFileSync(0, 'utf8') : '';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({command, args, config}) + '\\n');
if (command === 'gh') {
  if (${JSON.stringify(cliToken === undefined)}) process.exit(1);
  process.stdout.write(${JSON.stringify(cliToken ?? '')});
} else if (command === 'curl') {
  const url = args.at(-1);
  if (url.startsWith('https://api.github.com/')) process.stdout.write(${JSON.stringify(JSON.stringify(nightly ? [release] : release))});
  else {
    if (!url.startsWith('https://github.com/dovocode/dovo-studio/releases/download/')) process.exit(1);
    fs.copyFileSync(${JSON.stringify(archive)}, args[args.indexOf('-o') + 1]);
  }
}
`,
      )
      // These fixture paths are shell-quoted, including spaces and command substitution characters.
      const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
      const missingCli = name === 'missing gh CLI'
      for (const command of missingCli ? ['curl'] : ['curl', 'gh'])
        await writeFile(
          join(bin, command),
          `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} ${command} "$@"\n`,
          { mode: 0o755 },
        )
      for (const [command, body] of [
        ['id', "printf '1000\\n'"],
        ['uname', 'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; esac'],
        ['getconf', 'exit 0'],
        ['systemctl', 'exit 0'],
      ])
        await writeFile(join(bin, command), `#!/bin/sh\n${body}\n`, { mode: 0o755 })

      if (missingCli) {
        for (const command of [
          'bash',
          'jq',
          'tar',
          'gzip',
          'sha256sum',
          'realpath',
          'mktemp',
          'rm',
          'mkdir',
          'ln',
          'mv',
        ])
          await symlink(`/usr/bin/${command}`, join(bin, command))
      }
      const environment = {
        ...process.env,
        PATH: missingCli ? bin : `${bin}:/usr/bin:/bin`,
        GH_TOKEN: '',
        GITHUB_TOKEN: '',
        ...credentials,
      }
      // The child installer requires an isolated home to verify real staging without touching user data.
      const output = execFileSync(
        'bash',
        [
          installer,
          '--data-dir',
          join(directory, 'data'),
          '--channel',
          nightly ? 'nightly' : 'stable',
        ],
        {
          env: { ...environment, HOME: join(directory, 'home') },
          encoding: 'utf8',
          timeout: 15000,
        },
      )
      assert.ok(output.includes(`Installed v${version}`))
      const requests = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const api = requests.find(
        (request) => request.command === 'curl' && request.args.at(-1).includes('api.github.com'),
      )
      assert.equal(api.config, expected ? `header = "Authorization: Bearer ${expected}"\n` : '')
      const download = requests.find(
        (request) => request.command === 'curl' && request.args.includes('-o'),
      )
      assert.equal(download.config, '')
      if (expected) {
        assert.ok(!api.args.join(' ').includes(expected))
        assert.ok(!download.args.join(' ').includes(expected))
        assert.ok(!output.includes(expected))
      }
      const lookups = requests.filter((request) => request.command === 'gh')
      assert.equal(lookups.length, Object.keys(credentials).length || missingCli ? 0 : 1)
      if (lookups.length)
        assert.deepEqual(lookups[0].args, ['auth', 'token', '--hostname', 'github.com'])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
