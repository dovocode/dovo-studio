import { createContext, useEffect, useRef, type ComponentRef, type ReactNode } from 'react'
import type { TextInput } from 'react-native'

type InvalidInput = { input: ComponentRef<typeof TextInput> | null; invalid: boolean }
export const FieldValidationContext = createContext<
  ((id: string, field: InvalidInput | null) => void) | null
>(null)

/** Focus once after a failed submission, never in response to live field errors. */
export function ValidationFields({
  children,
  validationAttempt = 0,
}: {
  children: ReactNode
  validationAttempt?: number
}) {
  const fields = useRef(new Map<string, InvalidInput>())
  const previousAttempt = useRef(validationAttempt)
  const register = useRef((id: string, field: InvalidInput | null) => {
    if (!field) {
      fields.current.delete(id)
      return
    }
    fields.current.set(id, field)
  }).current
  useEffect(() => {
    if (previousAttempt.current === validationAttempt) return
    previousAttempt.current = validationAttempt
    const frame = requestAnimationFrame(() => {
      const first = [...fields.current.values()].find((entry) => entry.invalid && entry.input)
      first?.input?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [validationAttempt])
  return (
    <FieldValidationContext.Provider value={register}>{children}</FieldValidationContext.Provider>
  )
}
