import { createContext, type ReactNode } from 'react'

export const SettingsFooterContext = createContext<((footer: ReactNode) => void) | null>(null)
