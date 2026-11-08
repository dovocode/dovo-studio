declare module '*.txt?raw' {
  const text: string
  export default text
}
declare module '*.md?raw' {
  const text: string
  export default text
}
declare module '*.png' {
  const source: string
  export default source
}
