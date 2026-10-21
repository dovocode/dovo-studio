import { useEffect, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import type { Artifact, PublishedArtifact } from '@dovo/protocol'
import { ArtifactFeedSetup } from './artifact-feed'
import { useMobileAccount } from '../../runtime/connection/account-provider'
import { Action } from '../controls/action'
import { Text } from './text'
import { useTheme } from '../theme'

export function ArtifactSharing({ artifact }: { artifact: Artifact }) {
  const account = useMobileAccount(),
    { styles } = useTheme()
  const [origin, setOrigin] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [published, setPublished] = useState<PublishedArtifact>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false
    setError('')
    void account.client
      .artifactService()
      .then((value) => {
        if (!disposed) setOrigin(value)
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Sharing unavailable')
      })
    return () => {
      disposed = true
    }
  }, [account.client, retry])
  const sessionId = account.client.sessionId()
  useEffect(() => {
    setPublished(undefined)
  }, [sessionId])
  const publish = () =>
    Alert.alert(
      'Publish private artifact?',
      `Upload “${artifact.title}”, version ${artifact.revision}, including all source files, to ${origin} as ${account.directory?.user.name}? Review the content for secrets first. Only you can open it until you invite someone or create a shareable link.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish private copy',
          onPress: () => {
            if (sessionId !== account.client.sessionId()) {
              setError('Account changed. Review the publishing account and try again')
              return
            }
            setBusy(true)
            setError('')
            void account.client
              .publishArtifact(artifact, origin)
              .then(setPublished)
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Publication failed'),
              )
              .finally(() => setBusy(false))
          },
        },
      ],
    )
  return (
    <View style={{ gap: 8, paddingVertical: 12 }} accessibilityLabel="Hosted artifact sharing">
      <Text style={styles.title}>Hosted sharing</Text>
      <Text style={styles.muted}>
        Publish a private saved copy. It remains available independently of this computer. Manage
        account invitations and optional expiring links in your browser.
      </Text>
      {!!origin && <Text style={styles.muted}>Destination: {origin}</Text>}
      {!account.directory ? (
        <>
          <Action
            label={account.busy ? 'Signing in…' : 'Sign in to publish'}
            disabled={account.busy || !origin}
            onPress={() => void account.client.signIn()}
          />
          {account.login && (
            <>
              <Text style={styles.text}>Compare sign-in code: {account.login.code}</Text>
              <Action secondary label="Cancel sign-in" onPress={() => account.client.cancel()} />
            </>
          )}
        </>
      ) : (
        <>
          <Text style={styles.muted}>Publishing as {account.directory.user.name}.</Text>
          {!published && (
            <Action
              label={busy ? 'Publishing…' : 'Publish private copy'}
              disabled={!origin || busy || account.busy || account.deletionPending}
              onPress={publish}
            />
          )}
        </>
      )}
      {published && (
        <>
          <Text style={styles.text}>Private copy published.</Text>
          <Action
            label="Manage invitations and links"
            onPress={() => {
              void Linking.openURL(published.manageUrl).catch((cause: unknown) =>
                setError(String(cause)),
              )
            }}
          />
          <Text selectable style={styles.muted}>
            {published.url}
          </Text>
        </>
      )}
      {published && (
        <ArtifactFeedSetup
          key={sessionId}
          artifact={artifact}
          publicationId={published.publicationId}
          origin={origin}
          client={account.client}
        />
      )}
      {!!(error || account.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || account.error}
        </Text>
      )}
      {!!error && !origin && (
        <Action
          secondary
          label="Retry sharing service"
          onPress={() => setRetry((value) => value + 1)}
        />
      )}
    </View>
  )
}
