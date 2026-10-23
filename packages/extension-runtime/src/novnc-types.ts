// noVNC 1.7 exports its ESM client from the package root; DefinitelyTyped still uses 1.6's path.
// Import this declaration so applications consuming the workspace package also receive the alias.
declare module '@novnc/novnc' {
  type RFB = import('@novnc/novnc/lib/rfb').default
  const RFB: typeof import('@novnc/novnc/lib/rfb').default
  export default RFB
}
