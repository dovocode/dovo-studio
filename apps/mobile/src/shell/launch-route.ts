let claimed = false

/**
 * A notification tap can open its screen while Open on launch still waits for saved preferences.
 * The claim keeps that screen, because the router path updates only after the next render.
 */
export function claimLaunchRoute() {
  claimed = true
}

export function launchRouteClaimed() {
  return claimed
}
