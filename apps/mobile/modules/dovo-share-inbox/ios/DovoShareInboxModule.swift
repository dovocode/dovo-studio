import Darwin
import ExpoModulesCore

public class DovoShareInboxModule: Module {
  private func failure(_ message: String) -> NSError {
    NSError(domain: "DovoShareInbox", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private func root() throws -> URL {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "ExpoShareIntoAppGroupId") as? String,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
      throw failure("Shared draft storage is unavailable.")
    }
    let root = container.appendingPathComponent("dovo-share-inbox", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
  }
  // The extension holds this advisory lock while providers are copying. The OS releases it on death.
  private func locked<T>(_ root: URL, operation: () throws -> T) throws -> T? {
    let descriptor = open(root.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw failure("Could not lock shared draft storage.") }
    defer { Darwin.close(descriptor) }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      if errno == EWOULDBLOCK { return nil }
      throw failure("Could not lock shared draft storage.")
    }
    defer { flock(descriptor, LOCK_UN) }
    return try operation()
  }
  public func definition() -> ModuleDefinition {
    Name("DovoShareInbox")
    AsyncFunction("pending") { () -> String in
      let root = try self.root()
      return try self.locked(root) {
        let directories = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey, .isDirectoryKey])
          .filter { try $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true }
          .sorted {
            let first = (try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            let second = (try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            return first < second
          }
        let manifests = try directories.compactMap { originalDirectory -> [String: String]? in
          let originalManifest = originalDirectory.appendingPathComponent("handoff.json")
          guard FileManager.default.fileExists(atPath: originalManifest.path) else {
            try FileManager.default.removeItem(at: originalDirectory)
            return nil
          }
          // Keep a valid, native-owned discard identity even if the manifest's own ID is corrupt.
          var directory = originalDirectory
          if UUID(uuidString: directory.lastPathComponent) == nil {
            directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.moveItem(at: originalDirectory, to: directory)
          }
          var envelope = ["id": directory.lastPathComponent]
          do {
            // Preserve the original bytes; JS parses and validates each handoff separately.
            envelope["manifest"] = String(decoding: try Data(contentsOf: directory.appendingPathComponent("handoff.json")), as: UTF8.self)
          } catch {
            envelope["error"] = "This saved share could not be read. Discard it and share the content again."
          }
          return envelope
        }
        return String(decoding: try JSONSerialization.data(withJSONObject: manifests), as: UTF8.self)
      } ?? "[]"
    }
    AsyncFunction("acknowledge") { (id: String) in
      guard UUID(uuidString: id) != nil else { throw self.failure("Invalid share ID.") }
      let root = try self.root()
      let removed: Bool? = try self.locked(root) {
        let directory = root.appendingPathComponent(id, isDirectory: true)
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
        return true
      }
      guard removed == true else { throw self.failure("Another share is still being saved. Try again.") }
    }
  }
}
