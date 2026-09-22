import { ForgeHttp } from './forge-http.js'
import { z } from 'zod'
import type { CommandSettings, ForgeConnection, ForgeCliProfileQuery } from '@dovo/protocol'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { runForgeCli, runForgeCliText } from './forge-cli.js'
import { HttpError } from '../errors.js'
import { readForgeCliProfiles } from './forge-cli-profiles.js'
export class ForgeCliAccounts {
  constructor(private settings: () => CommandSettings) {}
  profiles(input: ForgeCliProfileQuery, cwd?: string) {
    return readForgeCliProfiles(this.settings(), input, cwd)
  }
  async identity(connection: ForgeConnection, cwd?: string) {
    if (connection.provider === 'forgejo' || connection.provider === 'gitea') {
      const data = await new ForgeHttp(connection, () =>
        this.authorization(connection, false, cwd),
      ).json('api/v1/user')
      const user = z.object({ id: z.number(), login: z.string() }).parse(data)
      return JSON.stringify([connection.cliProfile, user.id, user.login])
    }
    return this.authorization(connection, false, cwd)
  }
  async githubToken(connection: ForgeConnection, cwd?: string) {
    const token = (
      await runForgeCli(
        this.settings().gh,
        [
          'auth',
          'token',
          '--hostname',
          new URL(connection.baseUrl).hostname,
          ...(connection.cliProfile ? ['--user', connection.cliProfile] : []),
        ],
        undefined,
        cwd,
      )
    ).trim()
    if (!token || /\s/.test(token))
      throw new HttpError(401, 'Authenticate the selected GitHub CLI account on the runtime host')
    return token
  }
  async authorization(connection: ForgeConnection, git = false, cwd?: string): Promise<string> {
    if (connection.provider === 'github') return `Bearer ${await this.githubToken(connection, cwd)}`
    if (connection.cliTool === 'fj') return `token ${await this.fjToken(connection, cwd)}`
    if (connection.provider === 'gitea' || connection.provider === 'forgejo')
      return `token ${await this.teaToken(connection, cwd)}`
    if (connection.provider === 'azure-devops') {
      const result = z
        .object({ accessToken: z.string().min(1) })
        .parse(
          privateJson(
            await runForgeCli(
              this.settings().az,
              [
                'account',
                'get-access-token',
                '--resource',
                '499b84ac-1321-427f-aa17-267ca6975798',
                '--output',
                'json',
                ...(connection.cliProfile ? ['--tenant', connection.cliProfile] : []),
              ],
              undefined,
              cwd,
            ),
          ),
        )
      return `Bearer ${result.accessToken}`
    }
    if (connection.provider === 'bitbucket') {
      const profile = z
        .object({
          name: z.string(),
          apiRoot: z.string().optional(),
          user: z.string().optional(),
          password: z.string().optional(),
          accessToken: z.string().optional(),
        })
        .parse(
          privateJson(
            await runForgeCli(
              this.settings().bb,
              [
                'profile',
                'get',
                '--show-secrets',
                '--output',
                'json',
                '--',
                connection.cliProfile!,
              ],
              undefined,
              cwd,
            ),
          ),
        )
      if (
        profile.name !== connection.cliProfile ||
        (profile.apiRoot && profile.apiRoot.replace(/\/$/, '') !== 'https://api.bitbucket.org/2.0')
      )
        throw new HttpError(400, 'The selected Bitbucket CLI profile must target Bitbucket Cloud')
      if (profile.accessToken)
        return git
          ? `Basic ${Buffer.from(`x-token-auth:${profile.accessToken}`).toString('base64')}`
          : `Bearer ${profile.accessToken}`
      if (profile.user && profile.password)
        return `Basic ${Buffer.from(`${git ? 'x-bitbucket-api-token-auth' : profile.user}:${profile.password}`).toString('base64')}`
      throw new HttpError(401, 'Authenticate the selected bb profile on the runtime host')
    }
    throw new HttpError(
      400,
      'This CLI uses its own API transport. Configure Git credentials on the runtime for cloning and fetching.',
    )
  }
  private async teaToken(connection: ForgeConnection, cwd?: string) {
    const data: unknown = privateJson(
      await runForgeCli(
        this.settings().tea,
        ['logins', 'list', '--output', 'json'],
        undefined,
        cwd,
      ),
    )
    const rows = z.array(z.record(z.string(), z.unknown())).parse(data)
    const selected = rows.find((row) => {
      const name = row.Name ?? row.name
      return typeof name === 'string' && name.toLowerCase() === connection.cliProfile?.toLowerCase()
    })
    const host = selected?.URL ?? selected?.url
    if (
      typeof host !== 'string' ||
      host.replace(/\/$/, '') !== connection.baseUrl.replace(/\/$/, '')
    )
      throw new HttpError(
        400,
        'The tea login does not match this server URL. Check the named login on the runtime.',
      )
    // tea api follows redirects itself. Read the selected login's refreshed credential
    // through its Git helper so ForgeHttp remains responsible for request boundaries.
    const url = new URL(connection.baseUrl)
    const result = await runForgeCliText(
      this.settings().tea,
      ['login', 'helper', 'get', '--login', connection.cliProfile!],
      `protocol=${url.protocol.slice(0, -1)}\nhost=${url.host}\npath=${url.pathname.slice(1)}\n\n`,
      cwd,
    )
    const fields = new Map(
      result
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf('=')
          if (separator <= 0)
            throw new HttpError(502, 'The tea credential helper returned invalid account data')
          return [line.slice(0, separator), line.slice(separator + 1)]
        }),
    )
    if (fields.get('host') !== url.host || fields.get('protocol') !== url.protocol.slice(0, -1))
      throw new HttpError(
        400,
        'The tea credential helper does not match this server URL. Check the named login on the runtime.',
      )
    const token = fields.get('password')
    if (!token) throw new HttpError(401, 'Authenticate the selected tea login on the runtime host')
    return token
  }
  private async fjToken(connection: ForgeConnection, cwd?: string) {
    const url = new URL(connection.baseUrl)
    if (url.pathname !== '/')
      throw new HttpError(400, 'Use tea for servers hosted beneath a URL path')
    if (connection.cliProfile && connection.cliProfile !== url.host)
      throw new HttpError(400, 'The selected fj account does not match this server URL')
    await runForgeCli(this.settings().fj, ['--host', connection.baseUrl, 'whoami'], undefined, cwd)
    const home = homedir()
    const paths =
      process.platform === 'darwin'
        ? ['forgejo-cli', 'Cyborus'].map((org) =>
            path.join(home, 'Library', 'Application Support', `${org}.forgejo-cli`, 'keys.json'),
          )
        : process.platform === 'win32'
          ? ['forgejo-cli', 'Cyborus'].map((org) =>
              path.join(
                process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
                org,
                'forgejo-cli',
                'data',
                'keys.json',
              ),
            )
          : [
              path.join(
                process.env.XDG_DATA_HOME && path.isAbsolute(process.env.XDG_DATA_HOME)
                  ? process.env.XDG_DATA_HOME
                  : path.join(home, '.local', 'share'),
                'forgejo-cli',
                'keys.json',
              ),
            ]
    for (const filename of paths) {
      let content: string
      try {
        content = await readFile(filename, 'utf8')
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
        throw new HttpError(500, 'Cannot read Forgejo CLI credentials')
      }
      const parsed = z
        .object({ hosts: z.record(z.string(), z.object({ token: z.string().min(1) })) })
        .safeParse(privateJson(content))
      if (!parsed.success)
        throw new HttpError(401, 'Forgejo CLI credentials are invalid; sign in again with fj')
      const token = parsed.data.hosts[url.host]?.token
      if (!token) throw new HttpError(401, 'Sign in to this server using fj on the runtime host')
      return token
    }
    throw new HttpError(401, 'No Forgejo CLI account found on the runtime host')
  }
}

function privateJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new HttpError(
      502,
      'The CLI returned invalid account data. Check the configured executable and sign in again.',
    )
  }
}
