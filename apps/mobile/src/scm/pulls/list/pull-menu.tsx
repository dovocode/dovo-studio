import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useApplicationState } from '../../../runtime/state/application-state'
import { Pressable } from 'react-native'
import { Text } from '../../../ui/content/text'
import { Action } from '../../../ui/controls/action'
import { Sheet } from '../../../ui/layout/sheet'
import { useTheme } from '../../../ui/theme'
import type { PullActionTarget } from './pull-actions'
import type { PullActionOption } from './pull-action-options'
export type PullMenuProps = {
  providerName?: string
  onRefresh: () => void
  onOpen: () => void
  onStartTask: (checkoutMode: 'new-branch' | 'pr-branch') => void
  prBranchAvailable: boolean
  refreshDisabled: boolean
  taskDisabled: boolean
  actions: PullActionOption[]
  onAction: (target: PullActionTarget) => void
  actionDisabled: boolean
}
export function PullMenu(props: PullMenuProps) {
  const uiText = useInterfaceText()

  const { colors } = useTheme()

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
        accessibilityLabel={uiText('PR actions')}
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
        <Sheet title={uiText('PR actions')} onClose={() => setOpen(false)}>
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
            label={uiText('New branch from PR')}
            disabled={props.taskDisabled}
            onPress={() => choose(() => props.onStartTask('new-branch'))}
          />
          <Action
            secondary
            label={uiText('Use PR branch')}
            disabled={props.taskDisabled || !props.prBranchAvailable}
            onPress={() => choose(() => props.onStartTask('pr-branch'))}
          />
          <Action
            secondary
            label={uiText('Open on {value0}', { value0: props.providerName ?? 'GitHub' })}
            onPress={() => choose(props.onOpen)}
          />
          <Action
            secondary
            label={uiText('Refresh details')}
            disabled={props.refreshDisabled}
            onPress={() => choose(props.onRefresh)}
          />
        </Sheet>
      )}
    </>
  )
}
