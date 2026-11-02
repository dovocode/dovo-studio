declare global {
  interface Window {
    /** Electron resolves only the native files supplied by the drop event. */
    dovoTerminalFilePath?: (file: File) => string
  }
}

export function terminalDropPaths(data: DataTransfer): string[] {
  if (!data.files.length) return []
  const resolve = window.dovoTerminalFilePath
  if (!resolve) throw new Error('Dropping file paths requires the desktop app.')
  return Array.from(data.files, (file) => {
    const path = resolve(file)
    if (!path) throw new Error(`The path for ${file.name} is unavailable.`)
    return path
  })
}
