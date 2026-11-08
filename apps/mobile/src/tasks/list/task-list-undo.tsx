import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AccessibilityInfo, Alert, Pressable, View } from 'react-native'
import { Schema } from 'effect'
import type { RuntimeProfile, Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/context'
import { Text } from '../../ui/content/text'
import { Icon } from '../../ui/controls/icon'
import { useTheme } from '../../ui/theme'
import { taskListActionInput, type TaskListAction } from './task-list-action'

const actionResult = Schema.Struct({ ok: Schema.Boolean, undo: Schema.String })
const undoResult = Schema.Struct({ ok: Schema.Boolean })
type Notice = { token: string; profile: RuntimeProfile; action: TaskListAction; title: string }
type UndoContext = {
  busy: boolean
  run: (action: TaskListAction, task: Task, profile: RuntimeProfile, until?: string) => void
}
const Context = createContext<UndoContext | null>(null)

export function TaskListUndoProvider({ children }: { children: ReactNode }) {
  const { readRuntime, refreshRuntime } = useRuntime()
  const { colors } = useTheme()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  useEffect(() => {
    if (!notice) return
    AccessibilityInfo.announceForAccessibility(
      `${notice.title} ${notice.action === 'settle' ? 'settled' : 'snoozed'}. Undo available.`,
    )
    const timeout = setTimeout(() => setNotice(null), 15_000)
    return () => clearTimeout(timeout)
  }, [notice])

  const run = useCallback(
    (action: TaskListAction, task: Task, profile: RuntimeProfile, until?: string) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(true)
      setNotice(null)
      void (async () => {
        try {
          const result = await readRuntime(
            profile,
            '/api/tasks/list-action',
            taskListActionInput(action, task, until),
            actionResult,
          )
          if (!result.ok) throw new Error('The thread was not updated.')
          setNotice({ token: result.undo, profile, action, title: task.title })
          void refreshRuntime(profile).catch((error: unknown) => {
            Alert.alert(
              'Thread updated, but could not refresh',
              error instanceof Error ? error.message : String(error),
            )
          })
        } catch (error) {
          Alert.alert(
            'Could not confirm thread update',
            error instanceof Error ? error.message : String(error),
          )
        } finally {
          inFlight.current = false
          setBusy(false)
        }
      })()
    },
    [readRuntime, refreshRuntime],
  )

  const undo = useCallback(() => {
    if (!notice || inFlight.current) return
    const selected = notice
    setNotice(null)
    inFlight.current = true
    setBusy(true)
    void (async () => {
      try {
        const result = await readRuntime(
          selected.profile,
          '/api/tasks/list-action',
          {
            action: 'undo',
            token: selected.token,
          },
          undoResult,
        )
        if (!result.ok) throw new Error('The thread was not restored.')
        void refreshRuntime(selected.profile).catch((error: unknown) => {
          Alert.alert(
            'Undo applied, but could not refresh',
            error instanceof Error ? error.message : String(error),
          )
        })
      } catch (error) {
        Alert.alert('Could not undo', error instanceof Error ? error.message : String(error))
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    })()
  }, [notice, readRuntime, refreshRuntime])
  const context = useMemo(() => ({ busy, run }), [busy, run])

  return (
    <Context.Provider value={context}>
      {children}
      {notice && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            bottom: 80,
            left: 16,
            right: 16,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: colors.elevated,
            borderWidth: 1,
            borderColor: colors.border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ color: colors.text, flex: 1 }}>
            {notice.title} {notice.action === 'settle' ? 'settled' : 'snoozed'}
          </Text>
          <Pressable
            testID="Task list undo"
            accessibilityRole="button"
            accessibilityLabel={`Undo ${notice.action}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={undo}
            style={{ minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: colors.accent, fontWeight: '700' }}>Undo</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss undo notification"
            onPress={() => setNotice(null)}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
      )}
    </Context.Provider>
  )
}

export function useTaskListUndo() {
  const value = useContext(Context)
  if (!value) throw new Error('TaskListUndoProvider required')
  return value
}
