/** Invalid URLs must never issue a request with a coerced or unsafe PR number. */
export function pullRouteNumber(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}
