import { fileURLToPath } from 'node:url'
import { staticMiddleware } from 'srvx/static'
import web from './dist/server/server.js'

const dir = fileURLToPath(new URL('./dist/client/', import.meta.url))
const regularAssets = staticMiddleware({ dir })
const fingerprintedAssets = staticMiddleware({ dir, maxAge: 365 * 24 * 60 * 60, immutable: true })
const buildAsset = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/i

export default {
  ...web,
  middleware: [
    (request, next) =>
      (buildAsset.test(new URL(request.url).pathname) ? fingerprintedAssets : regularAssets)(
        request,
        next,
      ),
    ...(web.middleware ?? []),
  ],
}
