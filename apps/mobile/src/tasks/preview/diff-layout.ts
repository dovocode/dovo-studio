/** Reserve space for native tab stops, wide glyphs and accessibility text scaling. */
export function diffContentWidth(lines: readonly string[], viewport: number, textScale: number) {
  let columns = 0
  for (const line of lines) {
    let width = 0
    for (const character of line) {
      if (character === '\t') width += 8 - (width % 8)
      else width += (character.codePointAt(0) ?? 0) > 0xff ? 2 : 1
    }
    columns = Math.max(columns, width)
  }
  // Include the change marker and both line numbers, which scale with the code.
  return Math.max(viewport, (columns * 8 + 92) * textScale)
}
