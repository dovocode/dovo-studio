// The shortcut inbox consumes the original URL, including all task parameters.
// Route it to the workbench instead of letting Router treat it as an unknown screen.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.startsWith('dovo://task') || path.startsWith('/task?')) return '/'
  return path
}
