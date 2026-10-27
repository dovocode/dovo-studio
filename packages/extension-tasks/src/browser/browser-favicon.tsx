import { useState } from 'react'
import { Globe2 } from 'lucide-react'
import type { BrowserTab } from './shared-browser-tabs'

function source(tab: BrowserTab) {
  if (tab.favicon?.startsWith('data:image/') && tab.favicon.length <= 100_000) return tab.favicon
  // Only the owning browser can fetch with the right profile cookies and network access.
  return ''
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
      loading="eager"
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
