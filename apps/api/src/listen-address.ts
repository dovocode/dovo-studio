import { readFileSync } from 'node:fs'
import { writePrivateJson } from './private-json.js'

export function parseListenAddress(value: unknown): {
  address: string
  bindHost: string
  host: string
  port: number
} {
  if (
    !value ||
    typeof value !== 'object' ||
    !('address' in value) ||
    typeof value.address !== 'string'
  )
    throw new Error('Invalid saved runtime listening address')
  const url = new URL(value.address)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Invalid saved runtime listening address')
  const host = (
    'bindHost' in value && typeof value.bindHost === 'string' ? value.bindHost : url.hostname
  ).replace(/^\[|\]$/g, '')
  if (!host.trim()) throw new Error('Invalid saved runtime bind host')
  return {
    address: url.origin,
    bindHost: host,
    host,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
  }
}
export function readListenAddress(path: string) {
  return parseListenAddress(JSON.parse(readFileSync(path, 'utf8')))
}
export function writeListenAddress(path: string, value: { address: string; bindHost?: string }) {
  const { address, bindHost } = parseListenAddress(value)
  writePrivateJson(path, { address, bindHost })
}
