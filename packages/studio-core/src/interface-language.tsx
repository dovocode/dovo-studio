import { createContext, Fragment, useCallback, useContext, useMemo, type ReactNode } from 'react'
import {
  resolveInterfaceLanguage,
  type InterfaceLanguage,
  type threadInputSummary,
} from '@dovo/protocol'
import catalogData from './interface-catalog.json'
const catalogs: Readonly<Record<string, Readonly<Record<string, string>>>> = catalogData
const LanguageContext = createContext<InterfaceLanguage>('en-US')
export function InterfaceLanguageProvider({
  language,
  deviceLanguages = [],
  children,
}: {
  language: InterfaceLanguage
  deviceLanguages?: readonly string[]
  children: ReactNode
}) {
  const resolved = useMemo(
    () => resolveInterfaceLanguage(language, deviceLanguages),
    [language, deviceLanguages],
  )
  return <LanguageContext.Provider value={resolved}>{children}</LanguageContext.Provider>
}
export const useInterfaceLanguage = () => useContext(LanguageContext)
export type InterfaceValues = Readonly<Record<string, string | number | null | undefined>>
export function interfaceText(text: string, language: InterfaceLanguage, values?: InterfaceValues) {
  const base = language.split('-')[0]
  // Only explicitly marked UI copy enters this function. Unknown copy stays in English.
  const translated = catalogs[base]?.[text] ?? text
  return values
    ? translated.replace(/\{(\w+)\}/g, (match, key: string) =>
        Object.hasOwn(values, key) ? String(values[key] ?? '') : match,
      )
    : translated
}
export function useInterfaceText() {
  const language = useInterfaceLanguage()
  return useCallback(
    (text: string, values?: InterfaceValues) => interfaceText(text, language, values),
    [language],
  )
}
export function threadInputLabel(
  summary: Partial<ReturnType<typeof threadInputSummary>> | undefined,
  uiText: ReturnType<typeof useInterfaceText>,
) {
  const { approvals = 0, questions = 0, otherInputs = 0, uncounted } = summary ?? {}
  return [
    approvals > 0 &&
      (approvals === 1
        ? uiText('{value0} approval', { value0: approvals })
        : uiText('{value0} approvals', { value0: approvals })),
    questions > 0 &&
      (questions === 1
        ? uiText('{value0} question', { value0: questions })
        : uiText('{value0} questions', { value0: questions })),
    otherInputs > 0 &&
      (otherInputs === 1
        ? uiText('{value0} other input request', { value0: otherInputs })
        : uiText('{value0} other input requests', { value0: otherInputs })),
    uncounted && uiText('Needs input'),
  ]
    .filter(Boolean)
    .join(' · ')
}
export function InterfaceText({
  children,
  values,
}: {
  children: string
  values?: Readonly<Record<string, ReactNode>>
}) {
  const text = useInterfaceText()
  const translated = text(children)
  return (
    <>
      {values
        ? translated.split(/(\{\w+\})/g).map((part, index) => {
            const key = part.slice(1, -1)
            return (
              <Fragment key={index}>
                {part.startsWith('{') && part.endsWith('}') && Object.hasOwn(values, key)
                  ? values[key]
                  : part}
              </Fragment>
            )
          })
        : translated}
    </>
  )
}
export const interfaceDirection = (language: string) =>
  language.startsWith('ar') ? ('rtl' as const) : ('ltr' as const)
