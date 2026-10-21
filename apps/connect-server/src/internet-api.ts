import type { IncomingMessage, ServerResponse } from 'node:http'
import { Schema } from 'effect'
import {
  decode,
  internetRegistrationSchema,
  internetKeySchema,
  internetBoxSchema,
} from '@dovo/protocol'
import { bearerToken, json, readJson, RequestError } from './http.js'
import type { InternetStore } from './internet-store.js'
export function internetApi(store: InternetStore) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (!url.pathname.startsWith('/v1/internet/')) return false
    const token = bearerToken(req)
    if (req.method === 'PUT' && url.pathname === '/v1/internet/hosts')
      return json(
        res,
        200,
        store.register(token, decode(internetRegistrationSchema, await readJson(req))),
      )
    if (req.method === 'GET' && url.pathname === '/v1/internet/host')
      return json(res, 200, store.inbox(token))
    if (req.method === 'POST' && url.pathname === '/v1/internet/host/block') {
      const input = decode(Schema.Struct({ session: Schema.String }), await readJson(req))
      store.block(token, input.session)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/v1/internet/host') {
      const input = decode(
        Schema.Struct({ id: Schema.String, box: internetBoxSchema }),
        await readJson(req),
      )
      store.answer(token, input.id, input.box)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'DELETE' && url.pathname === '/v1/internet/host') {
      const host = store.host(token)
      if (!host) throw new RequestError(401, 'Internet access has been revoked')
      store.remove(host.user, host.id)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/v1/internet/connections') {
      const input = decode(
        Schema.Struct({ runtimeId: Schema.String, publicKey: internetKeySchema }),
        await readJson(req),
      )
      return json(res, 200, store.request(token, input.runtimeId, input.publicKey))
    }
    if (req.method === 'GET' && url.pathname === '/v1/internet/connections')
      return json(res, 200, store.result(token, url.searchParams.get('id') ?? ''))
    throw new RequestError(404, 'Not found')
  }
}
