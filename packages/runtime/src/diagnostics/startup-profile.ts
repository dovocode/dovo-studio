/** Opt-in process-local startup milestones. Times include module loading in the total. */
export function startupProfile(component: string) {
  if (process.env.DOVO_STARTUP_PROFILE !== '1') return undefined
  let previous = process.uptime() * 1000
  return (phase: string) => {
    const now = process.uptime() * 1000
    console.error(
      `[dovo startup] ${component} ${phase}: +${(now - previous).toFixed(1)}ms, total ${now.toFixed(1)}ms`,
    )
    previous = now
  }
}
