export type DeletionProgress = { verified: boolean; verify: () => void }
export type DeleteIdentity = (id: string, progress: DeletionProgress) => Promise<void>
