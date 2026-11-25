import { useEffect, useState } from 'react'

export function useFilePages(key: string) {
  const [history, setHistory] = useState<{ key: string; cursors: string[] }>()
  const cursors = history?.key === key ? history.cursors : undefined
  useEffect(() => {
    setHistory((previous) => (previous?.key === key ? previous : undefined))
  }, [key])
  return {
    cursor: cursors?.at(-1),
    hasPrevious: (cursors?.length ?? 0) > 1,
    next: (current: string, next: string) =>
      setHistory({ key, cursors: [...(cursors ?? [current]), next] }),
    previous: () => {
      if (cursors && cursors.length > 1) setHistory({ key, cursors: cursors.slice(0, -1) })
    },
  }
}
