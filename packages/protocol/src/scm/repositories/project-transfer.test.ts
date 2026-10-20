import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import { runtimeProfile } from '../../runtime/connection/runtime-fleet.js'
import { projectTransferPeers, projectTransferStartSchema } from './project-transfer.js'

it('keeps the local destination usable and deduplicates a computer paired at multiple addresses', () => {
  const connection = {
    address: 'http://computer:5235',
    token: 'device-token-at-least-32-characters',
    runtimeId: 'target',
  }
  const local = { ...runtimeProfile(connection, 'Desktop'), id: 'local' }
  const source = runtimeProfile({
    ...connection,
    runtimeId: 'source',
    address: 'http://source:5235',
  })
  const duplicate = runtimeProfile(
    { ...connection, address: 'http://vpn-address:5235' },
    'Desktop VPN',
  )
  const peers = projectTransferPeers([local, source, duplicate], [], 'source')
  expect(peers).toHaveLength(1)
  expect(peers[0]?.connection.runtimeId).toBe('target')
  expect(projectTransferPeers([local], [], 'source')[0]?.id).toBe('target')
})

it('validates SSH options without accepting shell options, passwords or invalid ports', () => {
  const request = {
    id: 'copy',
    repositoryId: 'project',
    targetId: 'target',
    ignoredFiles: [],
    ssh: { sshHost: 'buildbox.local', sshUser: 'dominic', sshPort: 22, runtimePort: 5235 },
  }
  expect(decodeResult(projectTransferStartSchema, request).success).toBe(true)
  for (const changes of [
    { sshHost: '-oProxyCommand=evil' },
    { sshUser: 'user;command' },
    { sshHost: 'user:password@host' },
    { sshPort: 0 },
    { runtimePort: 65536 },
  ])
    expect(
      decodeResult(projectTransferStartSchema, { ...request, ssh: { ...request.ssh, ...changes } })
        .success,
    ).toBe(false)
})
