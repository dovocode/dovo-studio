import { studioReference, type Task } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { AccessibilityInfo, Alert } from 'react-native'
import { copyText } from '../../ui/content/clipboard'

export function useCopyThreadStudioId(
  task: Pick<Task, 'id' | 'replica'>,
  runtimeIdentity: string | undefined,
) {
  const uiText = useInterfaceText()
  const owner = (task.replica?.ownerRuntimeId ?? runtimeIdentity)?.trim()
  if (!owner || owner === 'local') return undefined
  let reference: string
  try {
    reference = studioReference(owner, 'thread', task.replica?.threadId ?? task.id)
  } catch {
    return undefined
  }
  return {
    label: uiText('Copy Studio ID (for agents)'),
    icon: 'copy' as const,
    onPress: () =>
      void copyText(reference).then(
        (result) => {
          if (result === 'copied')
            AccessibilityInfo.announceForAccessibility(uiText('Studio ID copied.'))
        },
        (error: unknown) =>
          Alert.alert(
            uiText('Could not copy'),
            error instanceof Error ? error.message : String(error),
          ),
      ),
  }
}
