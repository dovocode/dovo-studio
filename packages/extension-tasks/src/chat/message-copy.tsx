import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { MessageAction, MessageActions } from '@dovo/studio-ui'
export function MessageCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState('')
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
        <span role="alert" className="text-[10px] text-destructive">
          {error}
        </span>
      )}
    </MessageActions>
  )
}
