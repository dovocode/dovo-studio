import { useCallback } from 'react'
import { Effect } from 'effect'
import {
  assignRemoteSources,
  forgePullTarget,
  pullDetailSchema,
  pullRepositoryKey,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import {
  collectionSources,
  projectContentIdentity,
} from '../../../runtime/state/collection-sources'
import { integrationDraftKey } from '../../../runtime/state/detail-drafts'
import { useSourceIdentities, useSourceReader, verifiedSourceRead } from '../../source-reader'
import { mobileReaders } from '../../verified-reader'

/** Only reads borrow a replica. The caller still owns its runtime, cache and drafts. */
export function usePullReader(
  repositoryId: string,
  number: number,
  connectionId: string | undefined,
  enabled: boolean,
) {
  const { connection, profile, snapshot, connected, overviews, readRuntimeEffect } = useRuntime()
  const origin = useSourceReader(repositoryId, undefined, connectionId)
  const originKey = integrationDraftKey(connection, snapshot, repositoryId, undefined, connectionId)
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === repositoryId)
  const sources = collectionSources(overviews)
  const originSource = sources.find(
    (source) => source.profile.id === profile?.id && source.repository.id === repositoryId,
  )
  const remote = repository
    ? pullRepositoryKey(repository, originKey)
    : forgePullTarget(repositoryId)?.identity
  const candidates = useSourceIdentities(
    [
      ...(profile ? [{ key: originKey, profile, repositoryId, connectionId, connected }] : []),
      ...sources
        .filter(
          (source) =>
            source.profile.id !== profile?.id &&
            remote &&
            pullRepositoryKey(source.repository, source.key) === remote,
        )
        .map((source) => ({
          ...source,
          key: projectContentIdentity(source),
          repositoryId: source.repository.id,
          connectionId: undefined,
        })),
    ],
    (source) => source.key,
    (source) => ({ repositoryId: source.repositoryId, connectionId: source.connectionId }),
    enabled,
  )
  // A list read verifies the default binding too. It can authorize opening a new
  // detail after disconnection, but cannot authorize a different explicit account.
  const retained =
    mobileReaders.identity(originKey) ??
    (originSource && (!connectionId || connectionId === repository?.forge?.connectionId)
      ? mobileReaders.identity(projectContentIdentity(originSource))
      : undefined)
  const selected = assignRemoteSources(candidates, {
    previous: new Map([['pull', originKey]]),
    previousReaderIdentities: retained ? new Map([['pull', retained.readerIdentity]]) : undefined,
    requireSameReader: true,
    remote: () => 'pull',
  }).selected[0]
  const alternate = !connected && selected?.key !== originKey && retained ? selected : undefined
  const alternateKey = alternate?.key
  const alternateProfile = alternate?.profile
  const alternateRepositoryId = alternate?.repositoryId
  const expectedIdentity = retained?.readerIdentity
  const destination = retained?.destination
  const readDetail = useCallback(
    (refresh: boolean) => {
      if (
        !alternateProfile ||
        !alternateKey ||
        !alternateRepositoryId ||
        !expectedIdentity ||
        !destination
      )
        return origin.readEffect(
          '/api/scm/pulls/detail',
          { repositoryId, number, refresh, connectionId },
          pullDetailSchema,
        )
      const read: typeof origin.readEffect = (path, body, schema, method) =>
        readRuntimeEffect(alternateProfile, path, body, schema, method)
      return verifiedSourceRead(
        read,
        alternateKey,
        { repositoryId: alternateRepositoryId },
        expectedIdentity,
      )(
        '/api/scm/pulls/detail',
        { repositoryId: alternateRepositoryId, number, refresh },
        pullDetailSchema,
      ).pipe(
        Effect.map((value) => ({
          ...value,
          destination,
          pull: {
            ...value.pull,
            destination,
            connectionId: connectionId ?? repository?.forge?.connectionId,
          },
        })),
      )
    },
    [
      origin.readEffect,
      repositoryId,
      number,
      connectionId,
      repository?.forge?.connectionId,
      alternateProfile,
      alternateKey,
      alternateRepositoryId,
      expectedIdentity,
      destination,
      readRuntimeEffect,
    ],
  )
  return {
    readDetail,
    routed: !!alternate,
    readConnected: connected || !!alternate?.connected,
    acceptCurrentAccount: origin.acceptCurrentAccount,
  }
}
