import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import { peerAddress, resolvePeerTransport, peerTransportAddress } from '@dovo/protocol'
import {
  closePeerConnections,
  forgetPeerConnection,
  preparePeerConnection,
  setPeerConnectionsActive,
  replacePeerConnection,
  setPeerConnectionNetwork,
} from './peer-transport'
const native = vi.hoisted(() => ({ open: vi.fn<typeof import('./peer-native').openPeerTunnel>() }))
vi.mock('./peer-native', () => ({ openPeerTunnel: native.open }))
const config = { origin: 'https://connect.dovo.studio', secret: 'a'.repeat(64) }
const address = peerAddress(config)
const signal = () => new AbortController().signal
beforeEach(() => {
  native.open.mockReset()
  setPeerConnectionsActive(true)
  preparePeerConnection(config)
})
afterEach(() => {
  closePeerConnections()
  forgetPeerConnection(address)
  setPeerConnectionsActive(true)
})
it('shares one encrypted connection across reads and returns only its loopback origin', async () => {
  const tunnel = {
    address: 'http://127.0.0.1:12345',
    close: vi.fn<() => void>(),
    alive: () => true,
  }
  native.open.mockResolvedValue(tunnel)
  const results = await Promise.all([
    resolvePeerTransport(address, config, signal()),
    resolvePeerTransport(address, config, signal()),
  ])
  expect(native.open).toHaveBeenCalledOnce()
  expect(results).toEqual([tunnel.address, tunnel.address])
  expect(peerTransportAddress(address)).toBe(tunnel.address)
  expect(await resolvePeerTransport(address, config, signal())).toBe(tunnel.address)
  expect(native.open).toHaveBeenCalledOnce()
})
it.each(['background', 'network'])(
  'cancels a pending connection on %s changes and rejects its stale completion',
  async (cause) => {
    setPeerConnectionNetwork({ type: 'WIFI', isConnected: true })
    let complete: (tunnel: {
      address: string
      close: () => void
      alive: () => boolean
    }) => void = () => {}
    native.open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const first = resolvePeerTransport(address, config, signal())
    void first.catch(() => {})
    await vi.waitFor(() => expect(native.open).toHaveBeenCalledOnce())
    if (cause === 'background') {
      setPeerConnectionsActive(false)
      setPeerConnectionsActive(true)
    } else setPeerConnectionNetwork({ type: 'CELLULAR', isConnected: true })
    const stale = {
      address: 'http://127.0.0.1:12345',
      close: vi.fn<() => void>(),
      alive: () => true,
    }
    const fresh = { ...stale, address: 'http://127.0.0.1:23456', close: vi.fn<() => void>() }
    native.open.mockResolvedValueOnce(fresh)
    expect(await resolvePeerTransport(address, config, signal())).toBe(fresh.address)
    complete(stale)
    await expect(first).rejects.toThrow('closed')
    expect(stale.close).toHaveBeenCalledOnce()
    expect(peerTransportAddress(address)).toBe(fresh.address)
  },
)
it('does not send credentials to a stale proxy, forgotten pairing or mismatched key', async () => {
  preparePeerConnection(config)
  expect(peerTransportAddress(address)).toBe('http://127.0.0.1:0')
  forgetPeerConnection(address)
  await expect(resolvePeerTransport(address, undefined, signal())).rejects.toThrow('QR code')
  await expect(resolvePeerTransport(address, config, signal())).rejects.toThrow('QR code')
  await expect(
    resolvePeerTransport(address, { ...config, secret: 'b'.repeat(64) }, signal()),
  ).rejects.toThrow('identity')
  expect(native.open).not.toHaveBeenCalled()
})
it('aborts one caller without cancelling other reads or replaying requests', async () => {
  const tunnel = {
    address: 'http://127.0.0.1:12345',
    close: vi.fn<() => void>(),
    alive: () => true,
  }
  native.open.mockResolvedValue(tunnel)
  const abort = new AbortController()
  abort.abort(new Error('Caller cancelled'))
  await expect(resolvePeerTransport(address, config, abort.signal)).rejects.toThrow('cancelled')
  expect(native.open).not.toHaveBeenCalled()
  expect(await resolvePeerTransport(address, config, signal())).toBe(tunnel.address)
})
it('closes an opted-in relay immediately and prevents stale reads from enabling it again', async () => {
  const relay = { ...config, relay: 'dovo' as const }
  preparePeerConnection(relay)
  const tunnel = {
    address: 'http://127.0.0.1:12345',
    close: vi.fn<() => void>(),
    alive: () => true,
  }
  native.open.mockResolvedValue(tunnel)
  await resolvePeerTransport(address, relay, signal())
  expect(native.open.mock.calls[0]?.[0]).toEqual(relay)
  replacePeerConnection(config)
  expect(tunnel.close).toHaveBeenCalledOnce()
  await resolvePeerTransport(address, relay, signal())
  expect(native.open.mock.calls[1]?.[0]).toEqual(config)
})
it('reuses a tunnel for the same network and opens a fresh one after Wi-Fi/cellular handover', async () => {
  setPeerConnectionNetwork({ type: 'WIFI', isConnected: true })
  setPeerConnectionNetwork({ isConnected: true })
  const first = {
    address: 'http://127.0.0.1:12345',
    close: vi.fn<() => void>(),
    alive: () => true,
  }
  const next = { ...first, address: 'http://127.0.0.1:23456', close: vi.fn<() => void>() }
  native.open.mockResolvedValueOnce(first).mockResolvedValueOnce(next)
  await resolvePeerTransport(address, config, signal())
  setPeerConnectionNetwork({ type: 'WIFI', isConnected: true })
  expect(peerTransportAddress(address)).toBe(first.address)
  expect(first.close).not.toHaveBeenCalled()
  setPeerConnectionNetwork({ type: 'CELLULAR', isConnected: true })
  expect(first.close).toHaveBeenCalledOnce()
  expect(peerTransportAddress(address)).toBe('http://127.0.0.1:0')
  expect(await resolvePeerTransport(address, config, signal())).toBe(next.address)
  setPeerConnectionNetwork({ type: 'CELLULAR', isConnected: false })
  expect(next.close).toHaveBeenCalledOnce()
  expect(peerTransportAddress(address)).toBe('http://127.0.0.1:0')
})
