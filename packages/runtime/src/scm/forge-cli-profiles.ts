import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import {
  forgeCliProfilesSchema,
  type CommandSettings,
  type ForgeCliProfileQuery,
  type ForgeCliProfiles,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { runForgeCli } from './forge-cli.js'
export async function readForgeCliProfiles(
  commands: CommandSettings,
  input: ForgeCliProfileQuery,
  cwd?: string,
): Promise<ForgeCliProfiles> {
  const read = async (executable: string, args: string[]): Promise<unknown> => {
    const output = await runForgeCli(executable, args, undefined, cwd)
    if (!output.trim()) return []
    try {
      return JSON.parse(output) as unknown
    } catch {
      throw new HttpError(
        502,
        'The CLI returned invalid profile data. Update it on the runtime host.',
      )
    }
  }
  const baseUrl = input.baseUrl.replace(/\/$/, '')
  let profiles: ForgeCliProfiles['profiles'] = []
  let message: string | undefined
  if (input.provider === 'bitbucket') {
    const rows = decode(
      mutableArray(
        mutableStruct({
          name: Schema.String,
          apiRoot: Schema.optional(Schema.String),
          user: Schema.optional(Schema.String),
          default: Schema.optional(Schema.Boolean),
        }),
      ),
      await read(commands.bb, ['profile', 'list', '--output', 'json']),
    )
    profiles = rows
      .filter(
        (row) => (row.apiRoot?.replace(/\/$/, '') || 'https://api.bitbucket.org/2.0') === baseUrl,
      )
      .map((row) => ({
        id: row.name,
        name: row.name,
        baseUrl,
        username: row.user,
        active: row.default,
      }))
  } else if (input.provider === 'azure-devops') {
    const rows = decode(
      mutableArray(
        mutableStruct({
          tenantId: Schema.String,
          tenantDisplayName: Schema.optional(Schema.String),
          isDefault: Schema.optional(Schema.Boolean),
          user: Schema.optional(
            mutableStruct({
              name: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
      await read(commands.az, ['account', 'list', '--all', '--output', 'json']),
    )
    const tenants = new Map<string, ForgeCliProfiles['profiles'][number]>()
    for (const row of rows) {
      const current = tenants.get(row.tenantId)
      if (!current || row.isDefault)
        tenants.set(row.tenantId, {
          id: row.tenantId,
          name: row.tenantDisplayName || row.tenantId,
          username: row.user?.name,
          active: current?.active || row.isDefault || false,
        })
    }
    profiles = [...tenants.values()]
    message =
      'Select a Microsoft Entra tenant. The Azure CLI keeps its current signed-in identity; no default subscription is changed.'
  } else if (input.provider === 'github') {
    const host = new URL(baseUrl).hostname
    const data = decode(
      mutableStruct({
        hosts: Schema.mutable(
          Schema.Record({
            key: Schema.String,
            value: mutableArray(
              mutableStruct({
                login: Schema.String,
                active: Schema.optional(Schema.Boolean),
                tokenSource: Schema.optional(Schema.String),
              }),
            ),
          }),
        ),
      }),
      await read(commands.gh, ['auth', 'status', '--hostname', host, '--json', 'hosts']),
    )
    // Environment-only accounts cannot be retrieved by gh auth token --user.
    profiles = (data.hosts[host] ?? [])
      .filter((row) => row.login && !row.tokenSource?.endsWith('_TOKEN'))
      .map((row) => ({
        id: row.login,
        name: row.login,
        username: row.login,
        baseUrl,
        active: row.active,
      }))
    profiles = [...new Map(profiles.map((profile) => [profile.id, profile])).values()]
  } else if (input.cliTool === 'fj') {
    const url = new URL(baseUrl)
    const expected = `${url.host}${url.pathname === '/' ? '' : url.pathname}`
    const output = await runForgeCli(commands.fj, ['auth', 'list'], undefined, cwd)
    profiles = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((host) => host === expected)
      .map((host) => ({
        id: host,
        name: host,
        baseUrl,
      }))
    message =
      'fj stores one account for each server. Use a named tea login for multiple accounts on the same server.'
  } else {
    const rows = decode(
      mutableArray(
        Schema.mutable(
          Schema.Record({
            key: Schema.String,
            value: Schema.Unknown,
          }),
        ),
      ),
      await read(commands.tea, ['logins', 'list', '--output', 'json']),
    )
    for (const row of rows) {
      const name = row.name ?? row.Name,
        url = row.url ?? row.URL,
        user = row.user ?? row.User,
        active = row.default ?? row.Default
      if (typeof name !== 'string' || typeof url !== 'string' || url.replace(/\/$/, '') !== baseUrl)
        continue
      profiles.push({
        id: name,
        name,
        baseUrl,
        ...(typeof user === 'string'
          ? {
              username: user,
            }
          : {}),
        active: active === true || active === 'true',
      })
    }
  }
  return decode(forgeCliProfilesSchema, {
    profiles,
    message:
      message ??
      (profiles.length ? undefined : 'No matching signed-in CLI profiles found on this runtime.'),
  })
}
