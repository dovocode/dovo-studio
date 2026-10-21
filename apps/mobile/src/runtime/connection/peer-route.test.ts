import { expect, it } from 'vite-plus/test'
import { selectedPeerRoute } from './peer-route'

function stats(local: string, remote: string) {
  return new Map<string, unknown>([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    [
      'pair',
      {
        type: 'candidate-pair',
        state: 'succeeded',
        localCandidateId: 'local',
        remoteCandidateId: 'remote',
      },
    ],
    ['local', { type: 'local-candidate', candidateType: local }],
    ['remote', { type: 'remote-candidate', candidateType: remote }],
    ['unused-relay', { type: 'local-candidate', candidateType: 'relay' }],
    [
      'unused-pair',
      { type: 'candidate-pair', state: 'succeeded', localCandidateId: 'unused-relay' },
    ],
  ])
}
it.each([
  ['host', 'host'],
  ['srflx', 'prflx'],
])(
  'identifies direct traffic with %s/%s even when relay candidates were gathered',
  (local, remote) => {
    expect(selectedPeerRoute(stats(local, remote))).toBe('direct')
  },
)
it.each([
  ['relay', 'host'],
  ['host', 'relay'],
  ['relay', 'relay'],
])('detects TURN used by either side of the selected pair: %s/%s', (local, remote) => {
  expect(selectedPeerRoute(stats(local, remote))).toBe('relay')
})
it('supports a native selected-pair report without transport metadata', () => {
  const reports = stats('relay', 'host')
  reports.delete('transport')
  reports.set('pair', {
    type: 'candidate-pair',
    selected: true,
    state: 'succeeded',
    localCandidateId: 'local',
    remoteCandidateId: 'remote',
  })
  expect(selectedPeerRoute(reports)).toBe('relay')
})
it('does not guess from missing, incomplete or unselected reports', () => {
  expect(selectedPeerRoute(new Map())).toBeUndefined()
  const reports = stats('srflx', 'host')
  reports.delete('remote')
  expect(selectedPeerRoute(reports)).toBeUndefined()
  reports.delete('transport')
  expect(selectedPeerRoute(reports)).toBeUndefined()
})
