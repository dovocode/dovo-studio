export function terminalSelection(text: string) {
  if (!text.trim()) return null
  if (text.length > 100_000) throw new Error('Selection is too large (maximum 100,000 characters).')
  return text
}

export function terminalSelectionIsCurrent(
  owner: string,
  taskId: string,
  currentOwner: string,
  currentTaskId: string | undefined,
) {
  return owner === currentOwner && taskId === currentTaskId
}
