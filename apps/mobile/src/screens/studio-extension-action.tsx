import { MobileDataSource } from './studio-data-source'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useContext, useState } from 'react'
import { ExtensionSourceAccess } from './extension-source-access'
import { useAppActive } from '../runtime/state/app-active'
import { NavigationContext } from '../shell/navigation'
import { View } from 'react-native'
import { router, type Href } from 'expo-router'
import {
  isStudioDataSource,
  type ExtensionContribution,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import {
  callStudioExtension,
  readExtensionDataSource,
  openStudioExtension,
  useStudioSourcePolicy,
  useStudioAutoLoad,
} from '@dovo/studio-core'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { McpAppView } from '../ui/content/mcp-app'
import { Text } from '../ui/content/text'

const destination = {
  tasks: '/',
  terminal: '/terminal',
  browser: '/browser',
  dashboards: '/dashboards',
  jobs: '/settings/automations',
  pulls: '/pulls',
} satisfies Record<Extract<ExtensionContribution, { kind: 'studio' }>['destination'], Href>

export function ExtensionAction({
  entry,
  contribution,
}: {
  entry: StudioExtensionEntry
  contribution: Exclude<ExtensionContribution, { kind: 'view' }>
}) {
  const uiText = useInterfaceText()
  const { read, connected, snapshot } = useRuntime()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const foreground = useAppActive()
  const focused = useContext(NavigationContext)?.focused ?? true
  const policy = useStudioSourcePolicy(
    read,
    connected &&
      !!snapshot?.studioSourcePoliciesSupported &&
      (contribution.kind === 'app' || contribution.kind === 'tool'),
    ['extension', entry.id],
    entry.revision,
    contribution.id,
  )
  useStudioAutoLoad(
    connected && foreground && focused,
    !!policy.policy?.autoLoad,
    () => void activate(true),
  )
  async function activate(automatic = false) {
    if (open) {
      if (!automatic) setOpen(false)
      return
    }
    if (busy) return
    setBusy(true)
    setError('')
    setResult('')
    try {
      if (contribution.kind === 'tool') {
        setResult(
          JSON.stringify(
            (await callStudioExtension(read, entry, contribution.id, automatic)).data,
            null,
            2,
          ),
        )
      } else {
        const { contribution: opened } = await openStudioExtension(
          read,
          entry,
          contribution.id,
          automatic,
        )
        if (opened.kind === 'studio') router.navigate(destination[opened.destination])
        else if (opened.kind === 'app') setOpen(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (isStudioDataSource(contribution))
    return (
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header">{contribution.title}</Text>
        <MobileDataSource
          owner={['extension', entry.id]}
          revision={entry.revision}
          source={contribution}
          read={(automatic) => readExtensionDataSource(read, entry, contribution.id, automatic)}
        />
      </View>
    )

  return (
    <>
      {snapshot?.studioSourcePoliciesSupported &&
        (contribution.kind === 'tool' || contribution.kind === 'app') && (
          <ExtensionSourceAccess
            policy={policy}
            title={
              contribution.kind === 'tool'
                ? `${entry.installed?.name ?? entry.id} · ${contribution.server} · ${contribution.tool}`
                : contribution.title
            }
            app={contribution.kind === 'app'}
          />
        )}
      <Action
        label={open ? uiText('Close app') : busy ? uiText('Running…') : contribution.title}
        secondary
        disabled={
          !connected ||
          busy ||
          (contribution.kind === 'tool' &&
            !!snapshot?.studioSourcePoliciesSupported &&
            (!policy.policy || policy.policy.access === 'off'))
        }
        onPress={() => void activate()}
      />
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {result && <Text selectable>{result}</Text>}
      {open && connected && contribution.kind === 'app' && (
        <McpAppView
          visible
          extension={
            snapshot?.studioSourcePoliciesSupported
              ? { id: entry.id, contributionId: contribution.id }
              : undefined
          }
          reference={{
            id: contribution.appId,
            taskId: contribution.taskId,
            title: contribution.title,
          }}
        />
      )}
    </>
  )
}
