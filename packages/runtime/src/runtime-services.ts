import { Context } from 'effect'
import type { Services } from './services.js'

export class RuntimeServices extends Context.Service<RuntimeServices, Services>()(
  'dovo/RuntimeServices',
) {}
