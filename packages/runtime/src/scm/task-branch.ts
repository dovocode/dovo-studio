/** Use the title model's result without a second naming request on the send path. */
export function taskBranchName(title: string, uniqueKey: string) {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'task'
  return `dovo/${slug}-${uniqueKey}`
}
