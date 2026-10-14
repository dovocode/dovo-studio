import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react-native'
import { useTheme } from '../theme'

export function PullRequestIcon({
  state,
  draft,
  size = 18,
}: {
  state?: string
  draft?: boolean
  size?: number
}) {
  const { colors, mode } = useTheme()
  const Glyph =
    state === 'merged'
      ? GitMerge
      : state === 'closed'
        ? GitPullRequestClosed
        : draft
          ? GitPullRequestDraft
          : GitPullRequest
  const color =
    state === 'merged'
      ? mode === 'dark'
        ? '#a78bfa'
        : '#7c3aed'
      : state === 'closed'
        ? colors.error
        : draft || state !== 'open'
          ? colors.muted
          : colors.success
  return (
    <Glyph
      size={size}
      color={color}
      accessibilityLabel={
        draft && state === 'open' ? 'Draft pull request' : `${state ?? 'Linked'} pull request`
      }
    />
  )
}
