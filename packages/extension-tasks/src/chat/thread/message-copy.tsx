import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import { Check, Copy } from 'lucide-react'
import { MessageAction, MessageActions } from '@dovo/studio-ui'
export function MessageCopy({ text }: { text: string }) {
  const [copied, setCopied] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <MessageActions>
      <MessageAction
        label={copied ? 'Copied message' : 'Copy message'}
        className="size-6 text-muted-foreground"
        onClick={() => {
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true)
              setError('')
            })
            .catch((error) => setError(String(error)))
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </MessageAction>
      {error && (
        <span role="alert" className="text-[0.625rem] text-destructive">
          {error}
        </span>
      )}
    </MessageActions>
  )
}
