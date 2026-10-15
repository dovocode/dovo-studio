import { attachMemoryPressureHandler, createNativeEngine } from 'react-native-shiki-engine'
import { createSyntaxHighlighter } from './syntax-highlighter'

export const prepareSyntax = createSyntaxHighlighter(() => {
  const engine = createNativeEngine()
  attachMemoryPressureHandler(engine)
  return engine
})
