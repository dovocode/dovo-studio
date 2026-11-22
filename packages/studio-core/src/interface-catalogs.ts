type Catalog = Readonly<Record<string, string>>
type Loader = () => Promise<{ default: Catalog }>

// Static import paths let Vite split each language and Metro include local packs in the app.
const loaders: Readonly<Record<string, Loader | undefined>> = {
  ar: () => import('./interface-catalogs/ar'),
  bg: () => import('./interface-catalogs/bg'),
  cs: () => import('./interface-catalogs/cs'),
  da: () => import('./interface-catalogs/da'),
  de: () => import('./interface-catalogs/de'),
  el: () => import('./interface-catalogs/el'),
  es: () => import('./interface-catalogs/es'),
  et: () => import('./interface-catalogs/et'),
  fi: () => import('./interface-catalogs/fi'),
  fr: () => import('./interface-catalogs/fr'),
  hi: () => import('./interface-catalogs/hi'),
  hr: () => import('./interface-catalogs/hr'),
  hu: () => import('./interface-catalogs/hu'),
  it: () => import('./interface-catalogs/it'),
  ja: () => import('./interface-catalogs/ja'),
  ko: () => import('./interface-catalogs/ko'),
  nb: () => import('./interface-catalogs/nb'),
  nl: () => import('./interface-catalogs/nl'),
  pl: () => import('./interface-catalogs/pl'),
  pt: () => import('./interface-catalogs/pt'),
  ro: () => import('./interface-catalogs/ro'),
  ru: () => import('./interface-catalogs/ru'),
  sk: () => import('./interface-catalogs/sk'),
  sv: () => import('./interface-catalogs/sv'),
  tr: () => import('./interface-catalogs/tr'),
  uk: () => import('./interface-catalogs/uk'),
  vi: () => import('./interface-catalogs/vi'),
  zh: () => import('./interface-catalogs/zh'),
}
const loaded = new Map<string, Catalog>()
const pending = new Map<string, Promise<Catalog | undefined>>()
const baseLanguage = (language: string) => language.split('-')[0]
export const interfaceCatalog = (language: string) => loaded.get(baseLanguage(language))

/** Preload the selected locale for clients and server renders that know their locale. */
export function loadInterfaceCatalog(language: string): Promise<Catalog | undefined> {
  const base = baseLanguage(language)
  const cached = loaded.get(base)
  if (cached) return Promise.resolve(cached)
  const loading = pending.get(base)
  if (loading) return loading
  const loader = Object.hasOwn(loaders, base) ? loaders[base] : undefined
  if (!loader) return Promise.resolve(undefined)
  const task = loader()
    .then(({ default: catalog }) => {
      loaded.set(base, catalog)
      return catalog
    })
    .finally(() => pending.delete(base))
  pending.set(base, task)
  return task
}
