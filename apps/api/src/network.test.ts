import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import type { NetworkInterfaceInfo } from 'node:os'
import { discoverNetworks, networkUrls, resolveBindHost } from './network'

const { execute, interfaces } = vi.hoisted(() => ({
  execute: vi.fn<(command: string) => Promise<{ stdout: string }>>(),
  interfaces: vi.fn<() => NodeJS.Dict<NetworkInterfaceInfo[]>>(),
}))
vi.mock('node:util', () => ({ promisify: () => execute }))
vi.mock('node:os', () => ({ networkInterfaces: interfaces }))

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    internal,
    family: 'IPv4',
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    cidr: `${address}/24`,
  }
}

beforeEach(() => {
  interfaces.mockReturnValue({
    lo0: [ipv4('127.0.0.1', true)],
    en0: [ipv4('192.168.1.10')],
    utun0: [ipv4('100.64.1.2')],
    utun1: [ipv4('100.65.1.2')],
  })
  execute.mockImplementation((command) =>
    Promise.resolve({
      stdout: command === 'tailscale' ? '100.64.1.2\n' : '{"netbirdIp":"100.65.1.2/16"}',
    }),
  )
})
afterEach(() => vi.restoreAllMocks())

it('discovers the active LAN, Tailscale and NetBird addresses without advertising loopback', async () => {
  expect(await discoverNetworks()).toEqual([
    { network: 'tailscale', name: 'Tailscale', host: '100.64.1.2' },
    { network: 'netbird', name: 'NetBird', host: '100.65.1.2' },
    { network: 'local', name: 'en0', host: '192.168.1.10' },
  ])
})

it('continues discovery when an optional VPN client returns invalid JSON', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  execute.mockImplementation((command) =>
    Promise.resolve({ stdout: command === 'tailscale' ? '100.64.1.2' : 'Daemon is starting' }),
  )
  const networks = await discoverNetworks()
  expect(networks).toContainEqual({ network: 'local', name: 'en0', host: '192.168.1.10' })
  expect(networks).toContainEqual({ network: 'tailscale', name: 'Tailscale', host: '100.64.1.2' })
  expect(networks.some((entry) => entry.network === 'netbird')).toBe(false)
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('Could not read NetBird status'))
})

it('deduplicates interface aliases so one LAN address can be selected', async () => {
  interfaces.mockReturnValue({ en0: [ipv4('192.168.1.10')], alias: [ipv4('192.168.1.10')] })
  execute.mockRejectedValue(new Error('Client is not installed'))
  const networks = await discoverNetworks()
  expect(networks).toHaveLength(1)
  expect(resolveBindHost('local', networks)).toBe('192.168.1.10')
})

it('does not use stale VPN addresses no longer present on an interface', async () => {
  interfaces.mockReturnValue({ en0: [ipv4('192.168.1.10')] })
  expect(await discoverNetworks()).toEqual([
    { network: 'local', name: 'en0', host: '192.168.1.10' },
  ])
})

it('advertises reachable addresses for wildcard binds and only the selected specific bind', async () => {
  const networks = await discoverNetworks()
  const all = networkUrls('0.0.0.0', '51464', networks)
  expect(all.map((entry) => entry.address)).toEqual([
    'http://100.64.1.2:51464',
    'http://100.65.1.2:51464',
    'http://192.168.1.10:51464',
  ])
  expect(networkUrls('::', '51464', networks)).toEqual(all)
  expect(networkUrls('192.168.1.10', '51464', networks)).toEqual([all[2]])
  expect(networkUrls('127.0.0.1', '51464', networks)).toEqual([])
})

it('requires an explicit bind when a network has multiple addresses', async () => {
  interfaces.mockReturnValue({ en0: [ipv4('192.168.1.10')], en1: [ipv4('192.168.2.10')] })
  const networks = await discoverNetworks()
  expect(() => resolveBindHost('local', networks)).toThrow('Multiple local addresses')
  expect(() => resolveBindHost('tailscale', networks)).toThrow('No tailscale address found')
  expect(resolveBindHost('0.0.0.0', networks)).toBe('0.0.0.0')
})
