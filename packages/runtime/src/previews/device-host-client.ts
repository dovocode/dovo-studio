import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { WebSocket } from 'ws'
import { Schema } from 'effect'
import {
  decode,
  decodeBrowserFrame,
  remoteBrowserMessageSchema,
  mutableStruct,
  type DeviceHost,
  type PreviewDevice,
} from '@dovo/protocol'
import type { NativeSimulator } from './simulator-native.js'
import { openTunnel, stopSsh } from './device-host-ssh.js'
import { HttpError } from '../errors.js'
import { sameDeviceHostConnection } from './device-host-settings.js'
type Tunnel = Awaited<ReturnType<typeof openTunnel>>
export const remoteOpenSchema = mutableStruct({
  id: Schema.String,
  ticket: Schema.String,
  screenPoints: Schema.optional(mutableStruct({ width: Schema.Number, height: Schema.Number })),
})
export class DeviceHostClient {
  private tunnels = new Map<
    string,
    {
      host: DeviceHost
      pending: Promise<Tunnel>
      users: number
      idle?: ReturnType<typeof setTimeout>
    }
  >()
  private disposed = false
  async acquire(host: DeviceHost) {
    if (this.disposed) throw new HttpError(503, 'Runtime is shutting down')
    let entry = this.tunnels.get(host.id)
    if (
      entry &&
      (!sameDeviceHostConnection(entry.host, host) ||
        entry.host.identityFile !== host.identityFile ||
        entry.host.token !== host.token)
    ) {
      if (entry.users)
        throw new HttpError(
          409,
          'Device host connection changed; wait for its previous connection to close',
        )
      // Remove synchronously so concurrent acquisitions cannot reuse stale credentials.
      void this.closeHost(host.id).catch((error) =>
        console.warn('SSH tunnel cleanup failed', error),
      )
      entry = undefined
    }
    if (!entry) {
      entry = { host: { ...host }, pending: openTunnel(host), users: 0 }
      this.tunnels.set(host.id, entry)
      const current = entry
      void entry.pending
        .then((tunnel) => {
          tunnel.child.once('exit', () => {
            clearTimeout(current.idle)
            if (this.tunnels.get(host.id) === current) this.tunnels.delete(host.id)
          })
        })
        .catch(() => {
          if (this.tunnels.get(host.id) === current) this.tunnels.delete(host.id)
        })
    }
    clearTimeout(entry.idle)
    entry.users++
    let released = false
    const release = () => {
      if (released) return
      released = true
      entry.users--
      if (entry.users || this.tunnels.get(host.id) !== entry) return
      entry.idle = setTimeout(() => {
        void this.closeHost(host.id).catch((error) =>
          console.warn('SSH tunnel cleanup failed', error),
        )
      }, 60000)
      entry.idle.unref()
    }
    try {
      return { tunnel: await entry.pending, release }
    } catch (error) {
      release()
      throw error
    }
  }
  async request(
    host: DeviceHost,
    path: string,
    input: unknown = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!host.token)
      throw new HttpError(409, 'Pair this device host and save its device token first')
    const lease = await this.acquire(host)
    try {
      return await this.call(host, lease.tunnel, path, input, signal)
    } finally {
      lease.release()
    }
  }
  private call(
    host: DeviceHost,
    tunnel: Tunnel,
    path: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const runtime = new URL(host.runtimeAddress)
    const payload = Buffer.from(JSON.stringify(input))
    return new Promise((resolve, reject) => {
      const request = (runtime.protocol === 'https:' ? httpsRequest : httpRequest)(
        {
          hostname: '127.0.0.1',
          port: tunnel.port,
          path,
          method: 'POST',
          signal,
          servername: runtime.hostname.replace(/^\[|\]$/g, ''),
          headers: {
            Host: runtime.host,
            Authorization: `Bearer ${host.token}`,
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
          },
        },
        (response) => {
          let size = 0
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > 16 * 1024 * 1024)
              response.destroy(new HttpError(502, 'Device host response exceeds limit'))
            else chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () => {
            try {
              if (!response.statusCode || response.statusCode >= 400) {
                const status = response.statusCode ?? 502
                let message = `Device host request failed (${status})`
                try {
                  const value: unknown = JSON.parse(Buffer.concat(chunks).toString())
                  if (
                    value &&
                    typeof value === 'object' &&
                    'error' in value &&
                    typeof value.error === 'string'
                  )
                    message = value.error.replaceAll(host.token!, '[redacted]').slice(0, 2000)
                } catch {
                  /* Older runtimes may return a non-JSON error. Preserve the status. */
                }
                throw new HttpError(
                  status,
                  status === 401
                    ? 'Device host pairing token was rejected. Pair again or update its token.'
                    : message,
                )
              }
              resolve(JSON.parse(Buffer.concat(chunks).toString()))
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      request.setTimeout(
        path === '/api/device-host/install'
          ? 300000
          : path === '/api/device-host/open'
            ? 210000
            : path === '/api/device-host/devices'
              ? 120000
              : 60000,
        () => request.destroy(new HttpError(504, 'Device host request timed out')),
      )
      request.on('error', (error) =>
        reject(
          error instanceof HttpError
            ? error
            : new HttpError(502, 'Could not reach the paired runtime through SSH'),
        ),
      )
      request.end(payload)
    })
  }
  async driver(host: DeviceHost, taskId: string, device: PreviewDevice): Promise<NativeSimulator> {
    if (!host.token)
      throw new HttpError(409, 'Pair this device host and save its device token first')
    let opened = decode(
      remoteOpenSchema,
      await this.request(host, '/api/device-host/open', { taskId, id: device.id }),
    )
    let socket: WebSocket | undefined
    let stopped = true
    let closed = false
    let generation = 0
    const invoke = (path: string, extra = {}) =>
      this.request(host, `/api/device-host/${path}`, { taskId, id: opened.id, ...extra })
    const stop = () => {
      stopped = true
      generation++
      socket?.close()
      socket = undefined
    }
    return {
      screenPoints: opened.screenPoints ? () => opened.screenPoints! : undefined,
      start: (frame, report) => {
        stop()
        stopped = false
        const current = ++generation
        const fail = (error: Error) => {
          if (!stopped && !closed && current === generation) report(error)
        }
        // Each attachment needs a fresh, single-use ticket; reconnect reuses the owned session.
        void this.acquire(host)
          .then(async (streamLease) => {
            let attached = false
            try {
              const ticket = decode(
                remoteOpenSchema,
                await this.call(host, streamLease.tunnel, '/api/device-host/open', {
                  taskId,
                  id: device.id,
                }),
              )
              if (closed) {
                await this.request(host, '/api/device-host/close', { taskId, id: ticket.id })
                return
              }
              opened = ticket
              if (stopped || current !== generation) return
              const runtime = new URL(host.runtimeAddress)
              const url = new URL(
                `/ws/device-host/simulator?ticket=${encodeURIComponent(ticket.ticket)}`,
                streamLease.tunnel.address,
              )
              url.protocol = runtime.protocol === 'https:' ? 'wss:' : 'ws:'
              const options = {
                servername: runtime.hostname.replace(/^\[|\]$/g, ''),
                headers: { Host: runtime.host },
                handshakeTimeout: 10000,
                maxPayload: 16 * 1024 * 1024,
              }
              const client = (socket = new WebSocket(url, options))
              client.once('close', streamLease.release)
              attached = true
              client.on('message', (raw, binary) => {
                if (stopped || closed || current !== generation) return
                try {
                  const buffer = Array.isArray(raw)
                    ? Buffer.concat(raw)
                    : Buffer.isBuffer(raw)
                      ? raw
                      : Buffer.from(raw)
                  if (binary) {
                    const packet = decodeBrowserFrame(Uint8Array.from(buffer).buffer)
                    frame({
                      type: 'frame',
                      width: packet.width,
                      height: packet.height,
                      data: packet.data,
                    })
                    client.send(JSON.stringify({ type: 'frameAck', sequence: packet.sequence }))
                  } else {
                    const message = decode(
                      remoteBrowserMessageSchema,
                      JSON.parse(buffer.toString()),
                    )
                    if (message.type === 'error' || message.type === 'closed') {
                      fail(new Error(message.message.replaceAll(host.token!, '[redacted]')))
                      client.close()
                    }
                  }
                } catch {
                  fail(new Error('Invalid device host stream message'))
                  client.close()
                }
              })
              client.on('error', () => fail(new Error('Device host simulator stream failed')))
              client.on('close', () => fail(new Error('Device host simulator stream disconnected')))
            } finally {
              if (!attached) streamLease.release()
            }
          })
          .catch((error: Error) => fail(error))
        return stop
      },
      input: async (input) => {
        if (closed) throw new HttpError(404, 'Device host simulator preview closed')
        await invoke('input', { input })
      },
      release: async () => {
        if (!closed) await invoke('release')
      },
      close: async () => {
        if (closed) return
        closed = true
        stop()
        await invoke('close')
      },
    }
  }
  async closeHost(id: string) {
    const entry = this.tunnels.get(id)
    if (!entry) return
    this.tunnels.delete(id)
    clearTimeout(entry.idle)
    const result = await Promise.allSettled([entry.pending])
    if (result[0].status === 'fulfilled') await stopSsh(result[0].value.child)
  }
  async dispose() {
    this.disposed = true
    await Promise.all([...this.tunnels.keys()].map((id) => this.closeHost(id)))
  }
}
