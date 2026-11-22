import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  resolveInterfaceLanguage,
  type InterfaceLanguage,
  type threadInputSummary,
} from '@dovo/protocol'
import { interfaceCatalog, loadInterfaceCatalog } from './interface-catalogs'
export { loadInterfaceCatalog } from './interface-catalogs'
const LanguageContext = createContext<{
  language: InterfaceLanguage
  catalog?: ReturnType<typeof interfaceCatalog>
}>({ language: 'en-US' })
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
  const [, setLoaded] = useState<string>()
  const catalog = interfaceCatalog(resolved)
  useEffect(() => {
    if (catalog) return
    let active = true
    void loadInterfaceCatalog(resolved).then(
      (value) => {
        if (active && value) setLoaded(resolved)
      },
      (error: unknown) => console.warn('Could not load the interface language', error),
    )
    return () => {
      active = false
    }
  }, [resolved, catalog])
  const context = useMemo(() => ({ language: resolved, catalog }), [resolved, catalog])
  return <LanguageContext.Provider value={context}>{children}</LanguageContext.Provider>
}
export const useInterfaceLanguage = () => useContext(LanguageContext).language
export type InterfaceValues = Readonly<Record<string, string | number | null | undefined>>
export function interfaceText(text: string, language: InterfaceLanguage, values?: InterfaceValues) {
  return translate(text, interfaceCatalog(language), values)
}
function translate(
  text: string,
  catalog: ReturnType<typeof interfaceCatalog>,
  values?: InterfaceValues,
) {
  const translated = catalog && Object.hasOwn(catalog, text) ? (catalog[text] ?? text) : text
  return values
    ? translated.replace(/\{(\w+)\}/g, (match, key: string) =>
        Object.hasOwn(values, key) ? String(values[key] ?? '') : match,
      )
    : translated
}
export function useInterfaceText() {
  const { catalog } = useContext(LanguageContext)
  return useCallback(
    (text: string, values?: InterfaceValues) => translate(text, catalog, values),
    [catalog],
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
