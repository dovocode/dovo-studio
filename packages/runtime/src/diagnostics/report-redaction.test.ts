import { expect, it } from 'vite-plus/test'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { environmentSecrets, redactionCount, redactReportText } from './report-redaction'

// Realistic shapes: 32 random bytes as base64url, as Dovo issues device and owner tokens.
const deviceToken = 'Q9vJ3kTq_x7LmZp2RfA8sW-cY1nBdE4hUoK6gVtXy0M'
const ownerToken = 'mH2xT8qLz-4VbN0cR7wKfJ1sYp9uDgEa3iOtW6lQe5S'
const runToken = 'dovo_run_Zk3Lp8Qw-Rt5Ym2Nb7Vc1Xs4Hd9Gf6Ja0Ke_UoIi'
const secrets = {
  anthropic: 'sk-ant-api03-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv-WxYz_123456',
  openai: 'sk-proj-4fT9xQ2mL7vB1nK8rW3eY6uI0oP5aS',
  github: 'ghp_1A2b3C4d5E6f7G8h9I0jK1lM2nO3pQ4rS5tU',
  githubOauth: 'gho_9Z8y7X6w5V4u3T2s1R0qP9oN8mL7kJ6iH5gF',
  aws: 'AKIAIOSFODNN7EXAMPLE',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkb3ZvIn0.c2lnbmF0dXJlLXZhbHVl',
}

it('removes Dovo credentials, provider keys, headers, cookies and environment values', () => {
  const text = [
    `GET /api/snapshot Authorization: Bearer ${deviceToken}`,
    `owner credential ${ownerToken} accepted`,
    `agent used ${runToken}`,
    'pairing code: 48213907 expires in 120s',
    `{"pairingCode":"55120934","token":"${deviceToken}"}`,
    `ANTHROPIC_API_KEY=${secrets.anthropic} OPENAI_API_KEY="${secrets.openai}" pnpm dev`,
    'export DATABASE_URL=postgres://dovo:hunter2@db.internal:5432/dovo',
    `{"env":{"GITHUB_TOKEN":"${secrets.githubOauth}","LOG_LEVEL":"debug"}}`,
    `git push failed for ${secrets.github}`,
    `aws key ${secrets.aws}, session ${secrets.jwt}`,
    'Cookie: session=s%3Aabc123.def; theme=dark',
    'Set-Cookie: sid=XyZ123secretValue; Path=/; HttpOnly',
    'proxy-authorization: Basic dXNlcjpwYXNzd29yZA==',
    'x-api-key: live-key-0987654321',
  ].join('\n')
  const redacted = redactReportText(text)
  for (const value of [
    deviceToken,
    ownerToken,
    runToken,
    '48213907',
    '55120934',
    ...Object.values(secrets),
    'hunter2',
    'debug',
    's%3Aabc123',
    'theme=dark',
    'XyZ123secretValue',
    'dXNlcjpwYXNzd29yZA',
    'live-key-0987654321',
  ])
    expect(redacted).not.toContain(value)
  // Names and context stay, so the report remains useful.
  for (const kept of [
    'GET /api/snapshot',
    'ANTHROPIC_API_KEY=',
    'OPENAI_API_KEY="[redacted]"',
    'DATABASE_URL=',
    '"GITHUB_TOKEN"',
    'Cookie: [redacted]',
    'Set-Cookie: [redacted]',
    'pnpm dev',
  ])
    expect(redacted).toContain(kept)
  expect(redactReportText(redacted)).toBe(redacted)
  expect(redactionCount(redacted)).toBeGreaterThanOrEqual(15)
})

it('replaces literal secrets and home-directory user names in paths', () => {
  const text = [
    'pairing 31415926 requested',
    'Could not open /Users/dominic/Projects/app/package.json',
    'cwd /home/dominic/.dovo/projects/dovo-studio',
    'Profile C:\\Users\\Dominic\\AppData\\Roaming\\Dovo',
    'escaped C:\\\\Users\\\\Dominic\\\\AppData',
    'database /srv/dovo-home/runtime.sqlite',
  ].join('\n')
  const redacted = redactReportText(text, ['31415926'], '/home/dominic')
  expect(redacted).not.toContain('31415926')
  expect(redacted).not.toMatch(/dominic/i)
  expect(redacted).toContain('/Users/[user]/Projects/app/package.json')
  expect(redacted).toContain('/home/[user]/.dovo/projects/dovo-studio')
  expect(redacted).toContain('C:\\Users\\[user]\\AppData')
  expect(redacted).toContain('/srv/dovo-home/runtime.sqlite')
  expect(redactReportText(redacted, ['31415926'], '/home/dominic')).toBe(redacted)
})

it('keeps commit IDs, versions, ordinary code names and counts readable', () => {
  const text = [
    'Source commit: 4c481d9817385ece0a0cba127e4a65b2794f80ca',
    'Runtime version: 0.0.7-nightly.76',
    'at createProblemReportPreviewForRuntime (problem-report.ts:42:7)',
    'token count: 12 exitCode=1',
    'task 2f1c6b9e-6d3a-4f0b-9a52-1c2d3e4f5a6b finished',
  ].join('\n')
  expect(redactReportText(text, [], '/home/someone')).toBe(text)
})

it('collects credential-named environment values only', () => {
  expect(
    environmentSecrets({
      DOVO_OWNER_TOKEN: ownerToken,
      MY_SERVICE_PASSWORD: 'hunter2-very-secret',
      SHORT_KEY: 'abc',
      HOME: '/home/dominic',
      LANG: 'en_US.UTF-8',
    }),
  ).toEqual([ownerToken, 'hunter2-very-secret'])
})

it('removes user names and passwords from URLs of any scheme', () => {
  const urls = [
    ['postgres://dovo:hunter2@db.internal:5432/dovo', 'postgres://db.internal:5432/dovo'],
    ['postgresql://dovo:hunter2@db.internal/dovo', 'postgresql://db.internal/dovo'],
    ['redis://:hunter2@cache.internal:6379/0', 'redis://cache.internal:6379/0'],
    ['rediss://default:hunter2@cache.internal:6380', 'rediss://cache.internal:6380'],
    [
      'mongodb+srv://dovo:hunter2@cluster0.example.net/app',
      'mongodb+srv://cluster0.example.net/app',
    ],
    ['amqp://dovo:hunter2@queue.internal:5672/%2f', 'amqp://queue.internal:5672/%2f'],
    ['mysql://dovo:p@ss@db.internal/app', 'mysql://db.internal/app'],
    ['ftp://dovo:hunter2@files.internal/data', 'ftp://files.internal/data'],
    ['https://dovo:hunter2@git.internal/repo.git', 'https://git.internal/repo.git'],
  ]
  for (const [url, expected] of urls) {
    const redacted = redactReportText(`connect ${url} failed`, [], '/home/someone')
    expect(redacted).toBe(`connect ${expected} failed`)
    expect(redactReportText(redacted, [], '/home/someone')).toBe(redacted)
  }
  // Addresses without credentials and paths with `@` stay readable.
  const plain =
    'open http://127.0.0.1:51464/api/@scope/pkg and redis://cache:6379 and dovo@example.com'
  expect(redactReportText(plain, [], '/home/someone')).toBe(plain)
})

function generatedKeys() {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-redaction-keys-'))
  try {
    const keys = [
      // PKCS#1, the `BEGIN RSA PRIVATE KEY` format.
      generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      }).privateKey,
    ]
    try {
      keys.push(
        execFileSync('openssl', ['genpkey', '-algorithm', 'RSA'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      )
    } catch {
      // Without OpenSSL, Node.js writes the same PKCS#8 format.
      keys.push(
        generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        }).privateKey,
      )
    }
    try {
      const path = join(directory, 'id_ed25519')
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', path], {
        stdio: 'ignore',
      })
      keys.push(readFileSync(path, 'utf8'))
    } catch {
      keys.push(openSshKeyFixture)
    }
    return keys
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
// A throwaway ed25519 key, used only where ssh-keygen is not installed.
const openSshKeyFixture = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBQmZ3Ry6Ue7fXr5e2Lx3d7m0F8cQ3cLx0h0r8b0nW2bQAAAIgAAAAAAAAA
AAAAAAtzc2gtZWQyNTUxOQAAACBQmZ3Ry6Ue7fXr5e2Lx3d7m0F8cQ3cLx0h0r8b0nW2bQ
AAAEB+Jb3c+Zk9WmQx0Vq1Y7m0pN2e3r4t5y6u7i8o9p0q1lCZndHLpR7t9evl7YvHd3ub
QXxxDdwvHSHSvxvSdbZtAAAAAAECAwQF
-----END OPENSSH PRIVATE KEY-----
`
const keyBody = (key: string) =>
  key
    .split('\n')
    .filter((line) => line && !line.startsWith('-----'))
    // Short final lines can match ordinary text, so check the full-length lines and the
    // pieces between `+` and `/`.
    .flatMap((line) => [line, ...line.split(/[+/=]/).filter((part) => part.length >= 12)])

it('removes whole private keys, also from multi-line logs and cut-off blocks', () => {
  for (const key of generatedKeys()) {
    expect(key).toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/)
    const log = `before the key\nloaded key:\n${key}after the key\n`
    const redacted = redactReportText(log, [], '/home/someone')
    for (const part of keyBody(key)) expect(redacted).not.toContain(part)
    expect(redacted).toContain('before the key')
    expect(redacted).toContain('after the key')
    expect(redacted).toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY----- \[redacted\] -----END/)
    expect(redactReportText(redacted, [], '/home/someone')).toBe(redacted)

    // A JSON log line keeps the key on one line with escaped line breaks.
    const json = JSON.stringify({ privateKey: key, level: 'info' })
    const redactedJson = redactReportText(json, [], '/home/someone')
    for (const part of keyBody(key)) expect(redactedJson).not.toContain(part)
    expect(redactedJson).toContain('"level":"info"')

    // A log tail can start inside the key, and a length limit can cut its end.
    const lines = key.trimEnd().split('\n')
    const head = redactReportText(lines.slice(3).join('\n') + '\nnext line', [], '/home/x')
    for (const part of keyBody(lines.slice(3).join('\n'))) expect(head).not.toContain(part)
    expect(head).toContain('next line')
    const cut = redactReportText(`${lines.slice(0, -2).join('\n')}\n\nlater line`, [], '/home/x')
    for (const part of keyBody(lines.slice(0, -2).join('\n'))) expect(cut).not.toContain(part)
    expect(cut).toContain('later line')
  }
})

it('removes credentials in YAML, lower-case, command-line and provider token forms', () => {
  const values = {
    awsYaml: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    awsLower: 'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY',
    cli: 'cli-secret-value-123',
    cliQuoted: 'two words',
    passwd: 'passwd-value-42',
    pwd: 'pwd-value-43',
    npm: 'npm_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
    stripeLive: ['sk', 'live', 'A1b2C3d4'.repeat(4)].join('_'),
    stripeRestricted: ['rk', 'live', 'A1b2C3d4'.repeat(4)].join('_'),
    slack: 'T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
    dovoCookie: 'cookie-env-value',
  }
  const text = [
    `AWS_SECRET_ACCESS_KEY: ${values.awsYaml}`,
    `aws_secret_access_key = ${values.awsLower}`,
    `dovo-server connect --api-key ${values.cli} --verbose`,
    `tool --client-secret '${values.cliQuoted}' run`,
    `mysql --password ${values.passwd}`,
    `login passwd=${values.passwd} pwd=${values.pwd}`,
    `registry auth ${values.npm}`,
    `stripe ${values.stripeLive} and ${values.stripeRestricted}`,
    `POST https://hooks.slack.com/services/${values.slack} failed`,
    `DOVO_SESSION_COOKIE: ${values.dovoCookie}`,
  ].join('\n')
  const redacted = redactReportText(text, [], '/home/someone')
  for (const value of Object.values(values)) expect(redacted).not.toContain(value)
  for (const kept of [
    'AWS_SECRET_ACCESS_KEY: [redacted]',
    'aws_secret_access_key = [redacted]',
    '--api-key [redacted] --verbose',
    "--client-secret '[redacted]' run",
    'https://hooks.slack.com/services/[redacted] failed',
  ])
    expect(redacted).toContain(kept)
  expect(redactReportText(redacted, [], '/home/someone')).toBe(redacted)
})

it('keeps log prefixes, ordinary key names, counts and commit IDs readable', () => {
  const text = [
    'ERROR: Could not connect to the runtime',
    'LOG_LEVEL: debug',
    'WARN: retrying in 5s',
    'sort_key: createdAt, primary_key = id, public_key: present',
    'pnpm --max-tokens 4096 --model gpt-5',
    '{"inputTokens":123,"total_tokens":456,"tokenCount":3}',
    'Source commit: 4c481d9817385ece0a0cba127e4a65b2794f80ca',
    'npm install failed with code 1, see npm_debug.log',
    'skipped sk_live test because it needs a key',
  ].join('\n')
  expect(redactReportText(text, [], '/home/someone')).toBe(text)
})
