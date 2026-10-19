import { decode, relayResultSchema, type RelayNotification } from '@dovo/protocol'

export type PushDelivery = {
  send(message: RelayNotification): Promise<{ delivered: boolean; invalidToken: boolean }>
}
/** The private relay owns APNs/FCM credentials; mobile grants never reveal its shared key. */
export function pushRelay(env = process.env): PushDelivery | undefined {
  if (!env.DOVO_NOTIFICATION_RELAY_URL || !env.DOVO_NOTIFICATION_RELAY_TOKEN) return
  const url = new URL(env.DOVO_NOTIFICATION_RELAY_URL)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    env.DOVO_NOTIFICATION_RELAY_TOKEN.length < 32
  )
    throw new Error('Invalid notification relay configuration')
  return {
    async send(message) {
      const response = await fetch(url.href.replace(/\/$/, '') + '/v1/notifications', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.DOVO_NOTIFICATION_RELAY_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('Notification relay is unavailable')
      return decode(relayResultSchema, await response.json())
    },
  }
}
