import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  decode,
  managedPolicySchema,
  managedPolicyMessage,
  runtimePreferencesSchema,
  permissionPolicyWithinCeiling,
  agentSchema,
  commandsSchema,
  ValidationError,
  safeValidationIssues,
  type ManagedPolicyDocument,
  type ManagedPolicySummary,
  type Agent,
  type AgentDiscovery,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'

export function managedPolicyPath() {
  return (
    process.env.DOVO_POLICY_PATH ??
    (process.platform === 'darwin'
      ? '/Library/Application Support/DovoStudio/policy.json'
      : process.platform === 'win32'
        ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'DovoStudio', 'policy.json')
        : '/etc/dovo-studio/policy.json')
  )
}
function at(value: unknown, path: string) {
  let result = value
  for (const key of path.split('.')) {
    if (!result || typeof result !== 'object' || !Object.hasOwn(result, key)) return undefined
    result = Reflect.get(result, key)
  }
  return result
}
function put(value: Record<string, unknown>, path: string, next: unknown) {
  const keys = path.split('.')
  let target = value
  for (const key of keys.slice(0, -1)) {
    const current: unknown = target[key]
    const child: Record<string, unknown> =
      current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {}
    target[key] = child
    target = child
  }
  target[keys.at(-1)!] = structuredClone(next)
}

/** Loaded once at host startup; policy values never overwrite users' saved preferences. */
export class ManagedPolicy {
  readonly summary?: ManagedPolicySummary
  constructor(readonly document?: ManagedPolicyDocument) {
    if (!document) return
    const settings = Object.entries(document.settings ?? {})
    const paths = settings.map(([path]) => path)
    if (paths.some((path) => paths.some((other) => other !== path && other.startsWith(`${path}.`))))
      throw new Error('Managed settings cannot contain overlapping parent and child paths')
    for (const [path, { value }] of settings) {
      const keys = path.split('.')
      if (
        keys.some((key) => ['__proto__', 'prototype', 'constructor', ''].includes(key)) ||
        !Object.hasOwn(runtimePreferencesSchema.fields, keys[0]!)
      )
        throw new Error(`Unknown managed runtime setting: ${path}`)
      const sample: Record<string, unknown> = {}
      put(sample, path, value)
      const checked = decode(runtimePreferencesSchema, sample)
      if (!isDeepStrictEqual(at(checked, path), value))
        throw new Error(`Unknown or invalid managed runtime setting: ${path}`)
    }
    const maximum = document.limits?.maxPermission
    if (maximum && document.limits?.providers?.allowed?.includes('acp'))
      throw new Error(
        'A permission ceiling cannot allow arbitrary ACP launchers. Remove acp from providers.allowed.',
      )
    this.summary = {
      organization: document.organization,
      supportUrl: document.supportUrl,
      fingerprint: createHash('sha256').update(JSON.stringify(document)).digest('hex'),
      lockedSettings: settings.filter(([, setting]) => setting.locked).map(([path]) => path),
      maxPermission: maximum,
      allowedProviders: document.limits?.providers?.allowed,
      allowedClients: document.limits?.clients,
      disabledCapabilities: [
        ...(['sharing', 'connect', 'webhookTasks', 'browserCookieImport'] as const).filter(
          (key) => document.limits?.[key] === false,
        ),
        ...(document.limits?.clients && !document.limits.clients.includes('remote')
          ? ['remoteClients', 'connect']
          : []),
        ...(document.limits?.updates?.mode === 'off' ? ['updates'] : []),
        ...(document.limits?.updates?.allowNightly === false ? ['nightlyUpdates'] : []),
      ],
      lockedProviderFields: Object.fromEntries(
        Object.entries(document.limits?.providers?.instances ?? {})
          .filter(([, instance]) => instance.locked)
          .map(([provider, instance]) => [
            provider,
            Object.keys(instance).filter((key) => key !== 'locked'),
          ]),
      ),
    }
  }
  static load(path?: string) {
    const explicit = path !== undefined || process.env.DOVO_POLICY_PATH !== undefined
    path ??= managedPolicyPath()
    try {
      const info = statSync(path)
      if (!info.isFile() || info.size > 256 * 1024)
        throw new Error('Policy must be a JSON file smaller than 256 KiB')
      return new ManagedPolicy(decode(managedPolicySchema, JSON.parse(readFileSync(path, 'utf8'))))
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT' && !explicit)
        return new ManagedPolicy()
      // Schema diagnostics can embed administrator environment values. Keep startup/CLI
      // errors useful without exposing policy contents to clients or logs.
      const detail =
        cause instanceof Error && 'code' in cause
          ? String(cause.code)
          : cause instanceof SyntaxError
            ? 'invalid JSON'
            : 'invalid policy document'
      const issues =
        cause instanceof ValidationError
          ? ` (${safeValidationIssues(cause)
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join(' ')})`
          : ''
      throw new Error(`Cannot load managed policy at ${path}: ${detail}${issues}`)
    }
  }
  require(capability: string) {
    if (this.summary?.disabledCapabilities.includes(capability))
      throw new HttpError(403, managedPolicyMessage(this.summary, capability))
  }
  requireClient(client: 'desktop' | 'local-browser' | 'remote') {
    const allowed = this.document?.limits?.clients
    if (allowed && !allowed.includes(client))
      throw new HttpError(403, managedPolicyMessage(this.document!, `${client} clients`))
  }
  preferences(value: unknown) {
    const result: Record<string, unknown> = value && typeof value === 'object' ? { ...value } : {}
    for (const [path, setting] of Object.entries(this.document?.settings ?? {}))
      if (setting.locked || at(result, path) === undefined) put(result, path, setting.value)
    return result
  }
  validatePreferences(value: unknown) {
    for (const [path, setting] of Object.entries(this.document?.settings ?? {}))
      if (setting.locked && !isDeepStrictEqual(at(value, path), setting.value))
        throw new HttpError(403, `${this.document!.organization} manages ${path}.`)
  }
  storedPreferences(stored: unknown, previous: unknown, next: Record<string, unknown>) {
    const result = structuredClone(next)
    for (const path of Object.keys(this.document?.settings ?? {})) {
      if (!isDeepStrictEqual(at(previous, path), at(next, path))) continue
      const original = at(stored, path)
      if (original !== undefined) put(result, path, original)
      else {
        const keys = path.split('.')
        const parent = keys.length === 1 ? result : at(result, keys.slice(0, -1).join('.'))
        if (parent && typeof parent === 'object') Reflect.deleteProperty(parent, keys.at(-1)!)
      }
    }
    return result
  }
  configure<T extends AgentDiscovery>(agent: T): T {
    const limits = this.document?.limits
    if (!limits) return agent
    if (limits.providers?.allowed && !limits.providers.allowed.includes(agent.provider))
      throw new HttpError(
        403,
        managedPolicyMessage(this.document!, `the ${agent.provider} provider`),
      )
    if (limits.maxPermission && agent.provider === 'acp')
      throw new HttpError(
        403,
        managedPolicyMessage(this.document!, 'ACP providers under a permission ceiling'),
      )
    const instance = limits.providers?.instances?.[agent.provider]
    // A ceiling owns launcher configuration too: a user-supplied wrapper/flag/env could
    // otherwise bypass provider approvals. Host process configuration stays administrator-owned.
    const base = limits.maxPermission
      ? {
          ...agent,
          endpoint: '',
          executablePath:
            agent.provider === 'cursor'
              ? undefined
              : agent.provider === 'opencode'
                ? 'opencode'
                : decode(commandsSchema, {})[agent.provider],
          configDirectory: undefined,
          args: undefined,
          env: undefined,
          envSecrets: undefined,
        }
      : agent
    if (!instance) return base
    const locked = instance.locked || !!limits.maxPermission
    return {
      ...base,
      executablePath:
        locked && instance.executablePath !== undefined
          ? instance.executablePath
          : (base.executablePath ?? instance.executablePath),
      configDirectory:
        locked && instance.configDirectory !== undefined
          ? instance.configDirectory
          : (base.configDirectory ?? instance.configDirectory),
      args: locked && instance.args !== undefined ? instance.args : (base.args ?? instance.args),
      env: locked ? { ...base.env, ...instance.env } : { ...instance.env, ...base.env },
      // Resolved secret references cannot override administrator-pinned environment fields.
      envSecrets:
        base.envSecrets &&
        Object.fromEntries(
          Object.entries(base.envSecrets).filter(
            ([name]) => !instance.locked || !Object.hasOwn(instance.env ?? {}, name),
          ),
        ),
    }
  }
  agent(agent: Agent) {
    const configured = this.configure(agent)
    const ceiling = this.document?.limits?.maxPermission
    if (
      ceiling &&
      !permissionPolicyWithinCeiling({ provider: agent.provider, permission: ceiling }, configured)
    )
      throw new HttpError(
        403,
        `${this.document!.organization} limits threads to ${ceiling}. Lower this thread's access mode before continuing.`,
      )
    return decode(agentSchema, configured)
  }
}
