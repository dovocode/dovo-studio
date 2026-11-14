import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react-native'
import { useTheme } from '../theme'

export function usePullRequestColor(state?: string, draft?: boolean) {
  const { colors } = useTheme()
  return state === 'merged'
    ? colors.done
    : state === 'closed'
      ? colors.error
      : draft || state !== 'open'
        ? colors.muted
        : colors.success
}

export function PullRequestIcon({
  state,
  draft,
  size = 18,
}: {
  state?: string
  draft?: boolean
  size?: number
}) {
  const uiText = useInterfaceText()

  const color = usePullRequestColor(state, draft)
  const Glyph =
    state === 'merged'
      ? GitMerge
      : state === 'closed'
        ? GitPullRequestClosed
        : draft
          ? GitPullRequestDraft
          : GitPullRequest
  return (
    <Glyph
      size={size}
      color={color}
      accessibilityLabel={
        draft && state === 'open'
          ? uiText('Draft pull request')
          : uiText('{value0} pull request', { value0: state ?? 'Linked' })
      }
    />
  )
}
