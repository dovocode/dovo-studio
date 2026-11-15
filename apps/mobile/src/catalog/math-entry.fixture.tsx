// Build only in an isolated native test checkout. Never use this as the release entry.
import { registerRootComponent } from 'expo'
void import('./math-example').then(
  ({ MathExample }) => registerRootComponent(MathExample),
  (error: unknown) =>
    console.error('Math fixture failed', error instanceof Error ? error.stack : String(error)),
)
