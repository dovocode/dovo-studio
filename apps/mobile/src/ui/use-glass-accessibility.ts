import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

/** Resolve once above navigation so new controls use the known system preferences. */
export function useGlassAccessibility() {
  const [reduceTransparency, setReduceTransparency] = useState(true)
  const [highContrast, setHighContrast] = useState(false)
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    let active = true
    let transparencyChanged = false
    let contrastChanged = false
    const transparency = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (value) => {
        transparencyChanged = true
        setReduceTransparency(value)
      },
    )
    const contrast = AccessibilityInfo.addEventListener('darkerSystemColorsChanged', (value) => {
      contrastChanged = true
      setHighContrast(value)
    })
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((value) => {
        if (active && !transparencyChanged) setReduceTransparency(value)
      })
      .catch(() => console.warn('Could not read Reduce Transparency; using opaque controls.'))
    void AccessibilityInfo.isDarkerSystemColorsEnabled()
      .then((value) => {
        if (active && !contrastChanged) setHighContrast(value)
      })
      .catch(() => console.warn('Could not read the system Increase Contrast setting.'))
    return () => {
      active = false
      transparency.remove()
      contrast.remove()
    }
  }, [])
  return { reduceTransparency, highContrast }
}
