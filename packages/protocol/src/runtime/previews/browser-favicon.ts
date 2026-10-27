/** An omitted icon is still loading (or comes from an older server); null means no icon. */
export function browserPageFavicon(
  previous: { url: string; favicon?: string },
  url: string,
  favicon: string | null | undefined,
): string | undefined {
  if (favicon !== undefined) return favicon ?? undefined
  try {
    if (new URL(previous.url).origin === new URL(url).origin) return previous.favicon
  } catch {
    // Empty/new tabs have no website identity.
  }
  return undefined
}
