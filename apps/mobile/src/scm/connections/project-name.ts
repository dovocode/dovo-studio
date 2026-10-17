export function suggestedProjectName(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.git$/, '') ?? ''
  )
}
