export function pullReference(input: string): { number: number; url?: string } {
  const text = input.trim()
  if (/^#?\d+$/.test(text)) {
    const number = Number(text.replace('#', ''))
    if (Number.isSafeInteger(number) && number > 0) return { number }
  }
  try {
    const url = new URL(text)
    const match = url.pathname.match(
      /\/(?:pull|pulls|pull-requests|pullrequest|merge_requests)\/(\d+)\/?$/i,
    )
    const number = Number(match?.[1])
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      Number.isSafeInteger(number) &&
      number > 0
    ) {
      url.hash = ''
      url.search = ''
      return { number, url: url.href.replace(/\/$/, '') }
    }
  } catch {
    // Fall through to the same actionable validation message for malformed URLs.
  }
  throw new Error('Enter a PR number or a full pull request URL.')
}

export function verifyPullUrl(input: string | undefined, actual: string) {
  if (!input) return
  const url = new URL(actual)
  url.hash = ''
  url.search = ''
  if (input !== url.href.replace(/\/$/, ''))
    throw new Error('That PR belongs to a different project. Use a PR from this task’s project.')
}

/** Extract full PR URLs only; a bare issue number is too ambiguous to auto-link. */
export function pullReferencesInText(text: string) {
  const links = new Map<string, { number: number; url: string }>()
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    try {
      const reference = pullReference(match[0].replace(/[.,;:!?)\]}]+$/, ''))
      if (reference.url) links.set(reference.url, { number: reference.number, url: reference.url })
    } catch {
      /* Other web links are not PR references. */
    }
  }
  return [...links.values()]
}
