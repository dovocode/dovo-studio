import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { resolveInterfaceLanguage, type InterfaceLanguage } from '@dovo/protocol'
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
export function interfaceText(text: string, language: InterfaceLanguage) {
  const base = language.split('-')[0]
  // Only explicitly marked UI copy enters this function. Unknown copy stays in English.
  return catalogs[base]?.[text] ?? text
}
export function useInterfaceText() {
  const language = useInterfaceLanguage()
  return useCallback((text: string) => interfaceText(text, language), [language])
}
export function InterfaceText({ children }: { children: string }) {
  const text = useInterfaceText()
  return <>{text(children)}</>
}
export const interfaceDirection = (language: string) =>
  language.startsWith('ar') ? ('rtl' as const) : ('ltr' as const)
