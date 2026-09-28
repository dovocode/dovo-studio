import * as Atom from '@effect-atom/atom/Atom'
import { Option } from 'effect'

/** State and its rendering projection share one authoritative atom. */
export function applicationState<A>(initial: A, publish?: (previous: A | undefined, next: A) => A) {
  // writable supports function values too; Atom.make would interpret them as computations.
  const atom = Atom.writable(
    () => initial,
    (context, value: A) => context.setSelf(value),
  )
  const view = publish
    ? Atom.make((get) => publish(Option.getOrUndefined(get.self<A>()), get(atom)))
    : atom
  return { atom, view }
}
