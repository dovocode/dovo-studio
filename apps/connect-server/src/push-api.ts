import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  decode,
  managedPushSubscriptionSchema,
  managedPushServersSchema,
  pushRegistrationSchema,
  relayNotificationSchema,
} from '@dovo/protocol'
import type { AccountStore } from './store.js'
import { PushStore } from './push-store.js'
import type { PushDelivery } from './push-relay.js'
import { bearerToken, json, readJson, RequestError } from './http.js'

export function pushApi(accounts: AccountStore, delivery?: PushDelivery) {
  const store = new PushStore(accounts)
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith('/v1/push/')) return false
    const token = bearerToken(req)
    if (req.method === 'POST' && url.pathname === '/v1/push/send') {
      const target = store.subscription(token)
      if (!target) throw new RequestError(401, 'Push permission expired or was revoked')
      const value = decode(relayNotificationSchema, await readJson(req))
      if (
        value.data.runtimeId !== target.runtimeId ||
        value.token !== target.token ||
        value.platform !== target.platform ||
        value.environment !== target.environment
      )
        throw new RequestError(403, 'Push permission does not match this device')
      if (!delivery) throw new RequestError(503, 'Managed push delivery is not configured')
      const result = await delivery.send(value)
      if (result.invalidToken) store.invalidate(token)
      json(res, 200, result)
      return true
    }
    if (!accounts.directory(token))
      throw new RequestError(401, 'Sign in to manage push notifications')
    if (req.method === 'PUT' && url.pathname === '/v1/push/subscriptions') {
      if (!delivery) throw new RequestError(503, 'Managed push delivery is not configured')
      const input = decode(managedPushSubscriptionSchema, await readJson(req))
      // Keep the same platform token validation as paired-runtime registration.
      const value = decode(pushRegistrationSchema, input)
      json(res, 200, store.subscribe(token, value))
      return true
    }
    if (req.method === 'PUT' && url.pathname === '/v1/push/servers') {
      const { runtimeIds } = decode(managedPushServersSchema, await readJson(req))
      store.retain(token, runtimeIds)
      json(res, 200, { ok: true })
      return true
    }
    throw new RequestError(404, 'Not found')
  }
}
