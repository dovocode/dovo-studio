import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
export function useCompactLayout() {
  const [compact, setCompact] = useApplicationState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setCompact(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return compact
}
