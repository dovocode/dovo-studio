import { useMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { mcpAppReferences } from '@dovo/protocol'
import { lazy, Suspense } from 'react'
const McpAppView = lazy(() =>
  import('../../../ui/content/mcp-app').then((module) => ({ default: module.McpAppView })),
)
import { useApplicationState } from '../../../runtime/state/application-state'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { toolPresentation } from '@dovo/protocol'
import { Text } from '../../../ui/content/text'
import { Icon, type IconName } from '../../../ui/controls/icon'
import { Markdown } from '../../../ui/content/markdown'
import { colors, styles } from '../../../ui/theme'
import { activityIdentity, pendingActivity, type TaskToolEvent } from '../state/tool-events'
export const activityIcon = (kind: ReturnType<typeof toolPresentation>['kind']): IconName =>
  kind === 'computer'
    ? 'device'
    : kind === 'command'
      ? 'terminal'
      : kind === 'web'
        ? 'web'
        : kind === 'file'
          ? 'folder'
          : kind === 'reasoning'
            ? 'chat'
            : 'settings'
export const activityStatus = (status: string) =>
  ['failed', 'error'].includes(status)
    ? 'Failed'
    : status === 'cancelled'
      ? 'Cancelled'
      : status === 'interrupted'
        ? 'Interrupted'
        : ''
export function ToolActivityRow({
  event,
  compact = false,
}: {
  event: TaskToolEvent
  compact?: boolean
}) {
  const [open, setOpen] = useApplicationState(false)
  const { showToolDetails } = useMobilePreferences()
  const detail = toolPresentation(event.payload, event.summary, event.inputPayload)
  const expandable = showToolDetails || (detail.kind === 'command' && !!detail.input)
  const running = pendingActivity(event.status)
  const status = activityStatus(event.status)
  return (
    <View
      style={{
        gap: 2,
      }}
    >
      <Pressable
        disabled={!expandable}
        accessibilityRole={expandable ? 'button' : 'text'}
        accessibilityState={{
          expanded: expandable ? open : undefined,
        }}
        accessibilityLabel={`${running ? 'Running · ' : ''}${detail.title}${status ? ` · ${status}` : ''}`}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Icon name={activityIcon(detail.kind)} size={14} color={colors.muted} />
        <Text
          numberOfLines={compact ? 1 : 2}
          style={[
            styles.muted,
            {
              flex: 1,
              fontSize: 13,
              lineHeight: 18,
            },
          ]}
        >
          {running && detail.kind === 'command' && detail.title === detail.input ? 'Running ' : ''}
          {detail.title}
        </Text>
        {running ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : (
          !!status && (
            <Text style={status === 'Failed' ? styles.error : styles.muted}>{status}</Text>
          )
        )}
        {expandable && <Icon name={open ? 'down' : 'next'} size={10} color={colors.muted} />}
      </Pressable>
      {mcpAppReferences(event.payload).map((reference) => (
        <Suspense key={reference.id} fallback={<Text>Loading app…</Text>}>
          <McpAppView reference={reference} />
        </Suspense>
      ))}
      {open && expandable && (
        <View
          style={{
            marginLeft: 6,
            paddingLeft: 16,
            paddingBottom: 10,
            borderLeftWidth: 1,
            borderColor: colors.border,
            gap: 8,
          }}
        >
          {!!detail.input && (showToolDetails || detail.kind === 'command') && (
            <Text
              selectable
              style={[
                styles.muted,
                {
                  fontFamily: detail.kind === 'command' ? 'Menlo' : undefined,
                  fontSize: 12,
                  lineHeight: 18,
                },
              ]}
            >
              {detail.input}
            </Text>
          )}
          {showToolDetails &&
            !!detail.output &&
            (detail.kind === 'reasoning' ? (
              <Markdown text={detail.output} variant="chat" />
            ) : (
              <Text
                selectable
                style={[
                  styles.muted,
                  {
                    fontSize: 12,
                    lineHeight: 18,
                    fontFamily: detail.kind === 'command' ? 'Menlo' : undefined,
                  },
                ]}
              >
                {detail.output}
              </Text>
            ))}
          {showToolDetails && !detail.output && (
            <Text style={styles.muted}>
              {running ? 'In progress…' : status || 'No output recorded'}
            </Text>
          )}
        </View>
      )}
    </View>
  )
}
export function ReasoningActivity({ events }: { events: TaskToolEvent[] }) {
  const [open, setOpen] = useApplicationState(false)
  if (!events.length) return null
  const active = events.some((event) => pendingActivity(event.status))
  const latest = events.at(-1)
  const status = latest && activityStatus(latest.status)
  return (
    <View
      style={{
        gap: 2,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          expanded: open,
        }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Icon name="chat" size={14} color={colors.muted} />
        <Text
          style={[
            styles.muted,
            {
              flex: 1,
              fontSize: 13,
            },
          ]}
        >
          {active ? 'Thinking' : 'Reasoning summary'}
          {status ? ` · ${status}` : ''}
        </Text>
        {active && <ActivityIndicator size="small" color={colors.muted} />}
        <Icon name={open ? 'down' : 'next'} size={10} color={colors.muted} />
      </Pressable>
      {open && (
        <View
          style={{
            paddingLeft: 22,
            paddingBottom: 8,
            gap: 8,
          }}
        >
          {events.map((event) => {
            const detail = toolPresentation(event.payload, event.summary, event.inputPayload)
            return (
              <Markdown
                key={activityIdentity(event)}
                text={detail.output || detail.input || detail.title}
                variant="chat"
              />
            )
          })}
        </View>
      )}
    </View>
  )
}
