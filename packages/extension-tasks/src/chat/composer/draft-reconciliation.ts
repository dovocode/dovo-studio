/** Server acknowledgements must not replace newer typing or resurrect the just-sent draft. */
export function reconcileComposerDraft(
  current: string,
  written: string,
  received: string,
  submitted: string | null,
  previousReceived?: string,
) {
  if (
    received === previousReceived ||
    current !== written ||
    (current === '' && submitted !== null && received.trim() === submitted)
  )
    return current
  return received
}
