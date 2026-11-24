import { parsePairingInvitation, pairingInvitationUrl, parseStudioLink } from '@dovo/protocol'
// The shortcut inbox consumes the original URL, including all task parameters.
// Route it to the workbench instead of letting Router treat it as an unknown screen.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const thread = parseStudioLink(path.startsWith('/thread?') ? `dovo:/${path}` : path)
  if (thread?.kind === 'thread') {
    const { runtimeId, threadId } = thread
    return `/open-thread?${new URLSearchParams({ runtimeId, threadId })}`
  }
  if (path.startsWith('dovo://launch') || path === '/launch' || path.startsWith('/launch?')) {
    try {
      const url = new URL(path.startsWith('/') ? `dovo:/${path}` : path)
      if (url.hostname === 'launch' || url.pathname === '/launch') return `/launch${url.search}`
    } catch {
      return '/launch'
    }
  }
  if (path === 'dovo://expo-sharing' || path === '/expo-sharing') return '/'
  if (path.startsWith('dovo://task') || path.startsWith('/task?')) return '/'
  if (path.startsWith('dovo://pair') || path.startsWith('/pair?')) {
    try {
      const invitation = parsePairingInvitation(path.startsWith('/') ? `dovo:/${path}` : path)
      return `/settings/devices?${new URL(pairingInvitationUrl(invitation)).searchParams}`
    } catch (error) {
      return `/settings/devices?pairingError=${encodeURIComponent(error instanceof Error ? error.message : 'Could not read pairing link.')}`
    }
  }
  return path
}
