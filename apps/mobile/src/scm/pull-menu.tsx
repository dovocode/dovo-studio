import { useApplicationState } from '../runtime/application-state'
import { Pressable } from 'react-native'
import { Text } from '../ui/text'
import { Action } from '../ui/action'
import { Sheet } from '../ui/sheet'
import { colors } from '../ui/theme'
import type { PullActionTarget } from './pull-actions'
import type { PullActionOption } from './pull-action-options'
export type PullMenuProps = {
  providerName?: string
  onRefresh: () => void
  onOpen: () => void
  onStartTask: () => void
  refreshDisabled: boolean
  taskDisabled: boolean
  actions: PullActionOption[]
  onAction: (target: PullActionTarget) => void
  actionDisabled: boolean
}
export function PullMenu(props: PullMenuProps) {
  const [open, setOpen] = useApplicationState(false)
  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }
  return (
    <>
      <Pressable
        testID="PR actions"
        accessibilityRole="button"
        accessibilityLabel="PR actions"
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.5 : 1,
        })}
        onPress={() => setOpen(true)}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 22,
          }}
        >
          ···
        </Text>
      </Pressable>
      {open && (
        <Sheet title="PR actions" onClose={() => setOpen(false)}>
          {props.actions.map((option) => (
            <Action
              key={option.action}
              secondary
              label={option.label}
              disabled={props.actionDisabled}
              onPress={() =>
                choose(() =>
                  props.onAction({
                    action: option.action,
                  }),
                )
              }
            />
          ))}
          <Action
            secondary
            label="Start task from PR"
            disabled={props.taskDisabled}
            onPress={() => choose(props.onStartTask)}
          />
          <Action
            secondary
            label={`Open on ${props.providerName ?? 'GitHub'}`}
            onPress={() => choose(props.onOpen)}
          />
          <Action
            secondary
            label="Refresh details"
            disabled={props.refreshDisabled}
            onPress={() => choose(props.onRefresh)}
          />
        </Sheet>
      )}
    </>
  )
}
