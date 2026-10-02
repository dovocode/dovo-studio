import type { CallToolResult, Tool, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { HttpError } from '../errors.js'
export const MAX_APP_BYTES = 2 * 1024 * 1024
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}
export function appUri(tool: Tool) {
  const meta = tool._meta ?? {}
  const uri = object(meta.ui).resourceUri ?? meta['ui/resourceUri']
  return typeof uri === 'string' && uri.startsWith('ui://') ? uri : undefined
}
export function visibleTo(tool: Tool, audience: 'model' | 'app') {
  const visibility = object(tool._meta?.ui).visibility
  return !Array.isArray(visibility) || visibility.includes(audience)
}
export function legacyResources(result: CallToolResult) {
  return result.content.flatMap((item) => {
    if (item.type !== 'resource') return []
    const resource = item.resource
    return resource.uri.startsWith('ui://') &&
      ['text/html', 'text/uri-list', 'application/vnd.mcp-ui.remote-dom'].includes(
        (resource.mimeType ?? '').split(';')[0].trim(),
      )
      ? [resource]
      : []
  })
}
export function isAppMime(mime: string | undefined) {
  const parts = (mime ?? '')
    .toLowerCase()
    .split(';')
    .map((part) => part.trim())
  return parts[0] === 'text/html' && parts.some((part) => /^profile="?mcp-app"?$/.test(part))
}
export function htmlResource(result: ReadResourceResult, uri: string) {
  const resource = result.contents.find((entry) => entry.uri === uri && isAppMime(entry.mimeType))
  if (!resource) throw new HttpError(422, 'MCP App did not return its declared HTML resource')
  if (JSON.stringify(resource).length > MAX_APP_BYTES)
    throw new HttpError(413, 'MCP App resource is too large')
  return resource
}
