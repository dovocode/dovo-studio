import { Globe2, MessageSquare, SquareTerminal } from 'lucide-react'

const types = {
  thread: { Icon: MessageSquare, label: 'Thread' },
  browser: { Icon: Globe2, label: 'Browser tab' },
  terminal: { Icon: SquareTerminal, label: 'Terminal' },
}

export function WorkspaceTypeBadge({ kind }: { kind: keyof typeof types }) {
  const { Icon, label } = types[kind]
  return (
    <span
      className="studio-workspace-type-badge"
      data-workspace-kind-icon={kind}
      aria-hidden="true"
      title={label}
    >
      <Icon strokeWidth={2} />
    </span>
  )
}
