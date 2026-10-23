import { Schema } from 'effect'
import { mutableStruct, refine } from '../shared/schema.js'

export const ACCOUNT_DIRECTORY_URL = 'https://connect.dovo.studio'
export function connectServiceOrigin(value: string) {
  const url = new URL(value.trim())
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))
  )
    throw new Error('Use an HTTPS Connect URL without credentials, a path, query or fragment')
  return url.origin
}
export const connectServiceOriginSchema = refine(
  Schema.String,
  (value) => {
    try {
      connectServiceOrigin(value)
      return true
    } catch {
      return false
    }
  },
  'Use an HTTPS Connect URL',
)
export const serviceUrlsSchema = mutableStruct({
  connectOrigin: refine(
    Schema.String,
    (value) => {
      try {
        connectServiceOrigin(value.trim() || ACCOUNT_DIRECTORY_URL)
        return true
      } catch {
        return false
      }
    },
    'Use an HTTPS Connect URL',
  ),
  artifactsOrigin: refine(
    Schema.String,
    (value) => {
      try {
        if (value.trim()) artifactServiceOrigin(value.trim())
        return true
      } catch {
        return false
      }
    },
    'Use an HTTP or HTTPS artifact service URL',
  ),
})
export type ServiceUrls = typeof serviceUrlsSchema.Type
export function normalizeServiceUrls(value: ServiceUrls): ServiceUrls {
  return {
    connectOrigin: connectServiceOrigin(value.connectOrigin.trim() || ACCOUNT_DIRECTORY_URL),
    artifactsOrigin: value.artifactsOrigin.trim()
      ? artifactServiceOrigin(value.artifactsOrigin.trim())
      : '',
  }
}
export function artifactServiceOrigin(value: string) {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use an HTTP or HTTPS artifact URL without credentials, a path, query or fragment',
    )
  return url.origin
}
