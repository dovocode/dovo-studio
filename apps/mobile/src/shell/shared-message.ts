import type { SharePayload } from 'expo-sharing'

/** Preserve shared text and links verbatim; file URIs are not messages. */
export function sharedMessage(payloads: readonly SharePayload[]): string {
  const values = payloads
    .filter((payload) => payload.shareType === 'text' || payload.shareType === 'url')
    .map((payload) => payload.value)
    .filter((value) => value.trim())
  const text = [...new Set(values)].join('\n\n')
  if (text.length > 12000)
    throw new Error('Shared text is too long. Share up to 12,000 characters.')
  return text
}
