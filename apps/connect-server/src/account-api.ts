import type { InternetStore } from './internet-store.js'
import type { DeleteIdentity } from './delete-identity.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { decode, accountServerSchema, accountServerAddress } from '@dovo/protocol'
import { AccountStore } from './store.js'
import { json, readJson, bearerToken, RequestError } from './http.js'

export function accountApi(
  store: AccountStore,
  origin: string,
  deleteIdentity?: DeleteIdentity,
  internet?: InternetStore,
) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (req.method === 'POST' && url.pathname === '/v1/login') {
      const { login, token } = store.createLogin()
      return json(res, 200, {
        token,
        code: login.code,
        url: origin + '/auth/start?id=' + login.id,
        expiresAt: login.expires,
      })
    }
    const bearer = bearerToken(req)
    if (req.method === 'DELETE' && url.pathname === '/v1/session') {
      store.revoke(bearer)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'DELETE' && url.pathname === '/v1/account') {
      const account = store.directory(bearer, true)
      if (!account) throw new RequestError(401, 'Sign in again to delete your account')
      const confirmation = await readJson(req)
      if (
        !confirmation ||
        typeof confirmation !== 'object' ||
        !('confirm' in confirmation) ||
        confirmation.confirm !== 'DELETE'
      )
        throw new RequestError(400, 'Confirm account deletion')
      if (store.organizationIdentity(account.user.id)) {
        store.deleteAccount(account.user.id)
        return json(res, 200, { ok: true })
      }
      if (!deleteIdentity)
        throw new RequestError(503, 'Account deletion is temporarily unavailable')
      // Block all ordinary account access and in-flight sign-ins before contacting the identity service.
      // Keep this session solely for retrying deletion if the provider response is interrupted.
      store.beginDeletion(account.user.id)
      try {
        await deleteIdentity(account.user.id, {
          verified: store.deletionVerified(account.user.id),
          verify: () => store.verifyDeletion(account.user.id),
        })
      } catch {
        throw new RequestError(
          409,
          'Account deletion has started. Retry to finish deleting your account.',
        )
      }
      store.deleteAccount(account.user.id)
      return json(res, 200, { ok: true })
    }
    const directory = store.directory(bearer)
    if (req.method === 'GET' && url.pathname === '/v1/login') {
      if (directory) return json(res, 200, { ready: true })
      const pending = store.pendingLogin(bearer)
      if (!pending) throw new RequestError(401, 'Sign-in expired. Start again.')
      return json(res, 200, { ready: false })
    }
    if (!directory) {
      if (store.directory(bearer, true))
        throw new RequestError(
          409,
          'Account deletion has started. Retry to finish deleting your account.',
        )
      throw new RequestError(401, 'Sign in to see your linked computers')
    }
    if (req.method === 'GET' && url.pathname === '/v1/servers') {
      const hosted = internet?.directory(directory.user.id) ?? []
      return json(res, 200, {
        ...directory,
        servers: [
          ...hosted.map((server) => ({
            ...server,
            address:
              directory.servers.find((link) => link.id === server.id)?.address ?? server.address,
          })),
          ...directory.servers.filter((item) => !hosted.some((server) => server.id === item.id)),
        ],
      })
    }
    if (req.method === 'PUT' && url.pathname === '/v1/servers') {
      let server
      try {
        server = decode(accountServerSchema, await readJson(req))
      } catch (error) {
        if (error instanceof RequestError) throw error
        throw new RequestError(400, 'Invalid computer')
      }
      if (
        !server.id ||
        server.id.length > 200 ||
        !server.name.trim() ||
        server.name.length > 200 ||
        server.address.length > 2048
      )
        throw new RequestError(400, 'Invalid computer')
      let address: string
      try {
        address = accountServerAddress(server.address)
      } catch {
        throw new RequestError(
          400,
          'Choose a reachable HTTP or HTTPS LAN/VPN address without credentials',
        )
      }
      store.link(directory.user.id, { ...server, address })
      return json(res, 200, { ok: true })
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/v1/servers/')) {
      const id = decodeURIComponent(url.pathname.slice('/v1/servers/'.length))
      internet?.remove(directory.user.id, id)
      store.unlink(directory.user.id, id)
      return json(res, 200, { ok: true })
    }
    throw new RequestError(404, 'Not found')
  }
}
