import { useState } from 'react'
import { Globe2 } from 'lucide-react'
import type { BrowserTab } from './shared-browser-tabs'

function source(tab: BrowserTab) {
  if (tab.favicon?.startsWith('data:image/') && tab.favicon.length <= 100_000) return tab.favicon
  // Remote localhost belongs to that computer. Never request it from the reader's machine.
  if (tab.kind !== 'web') return ''
  try {
    const url = new URL(tab.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return new URL('/favicon.ico', url).href
  } catch {
    return ''
  }
}
function Icon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  return url && !failed ? (
    <img
      src={url}
      alt=""
      aria-hidden
      width={16}
      height={16}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="size-4 shrink-0 object-contain"
      onError={() => setFailed(true)}
    />
  ) : (
    <Globe2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  )
}
export function BrowserFavicon({ tab }: { tab: BrowserTab }) {
  const url = source(tab)
  return <Icon key={url} url={url} />
}
