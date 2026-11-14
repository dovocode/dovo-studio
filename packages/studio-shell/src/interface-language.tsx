import { useEffect, type ReactNode } from 'react'
import { useAppPreferences } from '@dovo/studio-core'
import {
  InterfaceLanguageProvider,
  useInterfaceLanguage,
  interfaceDirection,
} from '@dovo/studio-core/interface-language'
export function AppInterfaceLanguage({ children }: { children: ReactNode }) {
  const { interfaceLanguage } = useAppPreferences()
  return (
    <InterfaceLanguageProvider language={interfaceLanguage} deviceLanguages={navigator.languages}>
      <DocumentLanguage />
      {children}
    </InterfaceLanguageProvider>
  )
}
function DocumentLanguage() {
  const language = useInterfaceLanguage()
  useEffect(() => {
    const root = document.documentElement
    const previous = { lang: root.lang, dir: root.dir }
    root.lang = language
    root.dir = interfaceDirection(language)
    return () => {
      root.lang = previous.lang
      root.dir = previous.dir
    }
  }, [language])
  return null
}
