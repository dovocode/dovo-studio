import { useApplicationState } from '@dovo/studio-core/state'

export function AuthorAvatar({ author, url }: { author: string; url?: string }) {
  const [failedUrl, setFailedUrl] = useApplicationState<string | undefined>(undefined)
  return (
    <span
      aria-hidden
      title={author}
      className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[0.625rem] font-medium text-muted-foreground ring-1 ring-border"
    >
      {url && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        author.trim().slice(0, 1).toUpperCase() || '?'
      )}
    </span>
  )
}
