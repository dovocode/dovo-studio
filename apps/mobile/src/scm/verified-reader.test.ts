import { expect, it } from 'vite-plus/test'
import { VerifiedReaders } from './verified-reader'
import { assignRemoteSources } from '@dovo/protocol'

it('retains the account and owner through remounts and global selection changes', () => {
  const readers = new VerifiedReaders()
  const first = readers.selection('merged PRs')
  first.owners.set('remote', 'a')
  first.readerIdentities.set('remote', 'github:account-a')
  const remounted = readers.selection('merged PRs')
  const sources = [
    { key: 'a', runtimeId: 'a', connected: true, readerIdentity: 'github:account-a' },
    { key: 'b', runtimeId: 'b', connected: true, readerIdentity: 'github:account-b' },
  ]
  const select = (candidates: typeof sources) =>
    assignRemoteSources(candidates, {
      previous: remounted.owners,
      previousReaderIdentities: remounted.readerIdentities,
      preferredRuntimeId: 'b',
      requireSameReader: true,
      remote: () => 'remote',
    })
  expect(select(sources).selected.map((source) => source.key)).toEqual(['a'])
  expect(
    select([{ ...sources[0], connected: false }, sources[1]]).selected.map((source) => source.key),
  ).toEqual(['a'])
  expect(select([sources[1]]).selected).toEqual([])
  expect(
    select([{ ...sources[1], readerIdentity: 'github:account-a' }]).selected.map(
      (source) => source.key,
    ),
  ).toEqual(['b'])
})

it('rejects changed accounts before replacing a verified identity and bounds retained records', () => {
  const readers = new VerifiedReaders(2)
  readers.remember('a', { readerIdentity: 'account-a', destination: 'repo-a' })
  expect(() =>
    readers.remember('a', { readerIdentity: 'account-b', destination: 'repo-a' }),
  ).toThrow(/different account/)
  expect(readers.identity('a')?.readerIdentity).toBe('account-a')
  expect(readers.candidateIdentity('a')).toBeUndefined()
  readers.remember('b', { readerIdentity: 'account-a', destination: 'repo-b' })
  readers.remember('c', { readerIdentity: 'account-a', destination: 'repo-c' })
  expect(readers.identity('a')).toBeUndefined()
  expect(readers.identity('b')).toBeDefined()
})

it('accepts an account change only after an explicit source choice, without rewriting the former scope', () => {
  const readers = new VerifiedReaders()
  readers.remember('source', { readerIdentity: 'old-account', destination: 'old-destination' })
  const previousView = readers.selection('merged')
  previousView.owners.set('remote', 'source')
  previousView.readerIdentities.set('remote', 'old-account')
  readers.acceptAccount('source')
  readers.resetSelection('explicit-source')
  readers.remember('source', { readerIdentity: 'new-account', destination: 'new-destination' })
  expect(readers.identity('source')?.readerIdentity).toBe('new-account')
  expect(previousView.readerIdentities.get('remote')).toBe('old-account')
  expect(readers.selection('explicit-source').readerIdentities.size).toBe(0)
})

it('rejects a same-account repository rebind before replacing the verified destination', () => {
  const readers = new VerifiedReaders()
  readers.remember('source', { readerIdentity: 'account', destination: 'repo-X' })
  expect(() =>
    readers.remember('source', { readerIdentity: 'account', destination: 'repo-Y' }),
  ).toThrow(/repository changed/)
  expect(readers.identity('source')?.destination).toBe('repo-X')
  expect(readers.candidateIdentity('source')).toBeUndefined()
  readers.acceptAccount('source')
  readers.remember('source', { readerIdentity: 'account', destination: 'repo-Y' })
  expect(readers.identity('source')?.destination).toBe('repo-Y')
})
