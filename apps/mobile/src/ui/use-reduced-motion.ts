import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'

/** Keep the OS preference as a minimum, even when Dovo's setting is System. */
export function useReducedMotion() {
  const { motion } = useMobilePreferences()
  const [system, setSystem] = useState(false)
  useEffect(() => {
    let active = true
    let changed = false
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true
      setSystem(value)
    })
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active && !changed) setSystem(value)
      })
      .catch(() => console.warn('Could not read the system Reduce motion setting'))
    return () => {
      active = false
      subscription.remove()
    }
  }, [])
  return motion === 'reduce' || system
}
