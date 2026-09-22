import type { Disposable } from './types.js'

export class DisposableStore implements Disposable {
  private readonly disposables = new Set<Disposable>()

  add<T extends Disposable>(disposable: T): T {
    this.disposables.add(disposable)
    return disposable
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose()
    }
    this.disposables.clear()
  }
}
