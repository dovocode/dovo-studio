import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { Effect } from 'effect'
import { ExtensionHost, runClientEffect } from '@dovo/client-runtime'
import type { ComponentType } from 'react'
type NativeContribution = {
  id: string
  title: string
  hidden?: boolean
  load: () => Promise<{
    default: ComponentType
  }>
}
export const contributions: NativeContribution[] = [
  {
    id: 'tasks',
    title: 'Tasks',
    load: () => import('../screens/tasks'),
  },
  {
    id: 'issues',
    title: 'Issues',
    load: () => import('../screens/issues'),
  },
  {
    id: 'scm',
    title: 'Projects',
    hidden: true,
    load: () => import('../screens/repositories'),
  },
  {
    id: 'pulls',
    title: 'PRs',
    load: () => import('../screens/pulls'),
  },
  {
    id: 'jobs',
    title: 'Jobs',
    load: () => import('../screens/jobs'),
  },
  {
    id: 'settings',
    title: 'Settings',
    load: () => import('../screens/settings'),
  },
]
export function createMobileExtensions() {
  const host = new ExtensionHost(),
    views = new Map<string, ComponentType>()
  for (const contribution of contributions)
    host.register({
      manifest: {
        id: `dovo.mobile.${contribution.id}`,
        name: contribution.title,
        version: '0.1.0',
        activationEvents: [`onCommand:mobile.${contribution.id}`],
      },
      activate: (context) => {
        return mobileWorkflow(function* () {
          views.set(contribution.id, (yield* nativeEffect(() => contribution.load())).default)
          context.subscriptions.push({
            dispose: () => {
              views.delete(contribution.id)
            },
          })
        })
      },
    })
  return {
    host,
    peek: (id: string) => views.get(id),
    view(id: string) {
      return runClientEffect(
        mobileWorkflow(function* () {
          yield* host.activateEffect(`dovo.mobile.${id}`)
          const view = views.get(id)
          if (!view)
            return yield* Effect.fail(new Error('Mobile extension did not register its view'))
          return view
        }),
      )
    },
  }
}
