import { configureDevelopmentEnvironment } from './dev-environment.js'

configureDevelopmentEnvironment(process.env)
await import('./index.js')
