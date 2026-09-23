import { parsePairingInvitation } from '@dovo/protocol'
// The shortcut inbox consumes the original URL, including all task parameters.
// Route it to the workbench instead of letting Router treat it as an unknown screen.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.startsWith('dovo://task') || path.startsWith('/task?')) return '/'
  if (path.startsWith('dovo://pair') || path.startsWith('/pair?')) {
    try {
      const invitation = parsePairingInvitation(path.startsWith('/') ? `dovo:/${path}` : path)
      return `/settings/devices?${new URLSearchParams(invitation)}`
    } catch (error) {
      return `/settings/devices?pairingError=${encodeURIComponent(error instanceof Error ? error.message : 'Could not read pairing link.')}`
    }
  }
  return path
}
