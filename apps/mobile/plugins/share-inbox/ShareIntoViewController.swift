import Darwin
import UIKit
import Social
import UniformTypeIdentifiers

// Each extension invocation owns its directory. Identical intentional shares remain distinct.
class ShareIntoViewController: SLComposeServiceViewController {
  private var started = false
  private let handoffId = UUID().uuidString
  private var remaining: Int64 = 50 * 1024 * 1024
  private var directory: URL!
  override func didSelectPost() { receive() }
  override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); receive() }
  private func receive() {
    guard !started else { return }
    started = true
    Task { @MainActor in
      do {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "AppGroupId") as? String,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
          throw failure("Shared draft storage is unavailable.")
        }
        let root = container.appendingPathComponent("dovo-share-inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let descriptor = open(root.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw failure("Could not lock shared draft storage.") }
        defer { Darwin.close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw failure("Could not lock shared draft storage.") }
        defer { flock(descriptor, LOCK_UN) }
        if let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey]) {
          for case let file as URL in enumerator {
            let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
            if values.isRegularFile == true { remaining -= Int64(values.fileSize ?? 0) }
          }
        }
        directory = root.appendingPathComponent(handoffId, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var payloads: [[String: String]] = []
        var issue: String?
        do {
          let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
          var fileCount = 0
          for provider in items.flatMap({ $0.attachments ?? [] }) {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) && !provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
              let value = try await loadValue(provider, identifier: UTType.url.identifier)
              payloads.append(["shareType": "url", "value": value])
            } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) ||
                [UTType.image, .movie, .audio, .pdf].contains(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) {
              fileCount += 1
              guard fileCount <= 5 else { throw failure("Attach up to 5 files per message.") }
              payloads.append(try await loadFile(provider, index: fileCount))
            } else if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
              payloads.append(["shareType": "text", "value": try await loadValue(provider, identifier: UTType.text.identifier)])
            } else if provider.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
              fileCount += 1
              guard fileCount <= 5 else { throw failure("Attach up to 5 files per message.") }
              payloads.append(try await loadFile(provider, index: fileCount))
            } else { throw failure("This shared item is not a supported file or text.") }
          }
        } catch { issue = error.localizedDescription; payloads = [] }
        var manifest: [String: Any] = ["id": handoffId, "payloads": payloads]
        if let issue {
          manifest["error"] = issue
          for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            try FileManager.default.removeItem(at: file)
          }
        }
        try JSONSerialization.data(withJSONObject: manifest).write(to: directory.appendingPathComponent("handoff.json"), options: .atomic)
        openParentApp()
      } catch {
        let alert = UIAlertController(title: "Could not save share", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Close", style: .default) { _ in self.extensionContext?.cancelRequest(withError: error) })
        present(alert, animated: true)
      }
    }
  }
  private func failure(_ message: String) -> NSError {
    NSError(domain: "DovoShareInbox", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
  private func loadValue(_ provider: NSItemProvider, identifier: String) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      provider.loadItem(forTypeIdentifier: identifier, options: nil) { item, error in
        if let error { continuation.resume(throwing: error) }
        else if let url = item as? URL { continuation.resume(returning: url.absoluteString) }
        else if let text = item as? String { continuation.resume(returning: text) }
        else { continuation.resume(throwing: self.failure("Could not read shared text.")) }
      }
    }
  }
  private func loadFile(_ provider: NSItemProvider, index: Int) async throws -> [String: String] {
    let identifier = provider.registeredTypeIdentifiers.first { value in
      guard let type = UTType(value) else { return false }
      return type.conforms(to: .data) && !type.conforms(to: .url)
    } ?? UTType.fileURL.identifier
    return try await withCheckedThrowingContinuation { continuation in
      let copy: (URL?, Error?) -> Void = { url, error in
        do {
          if let error { throw error }
          guard let url else { throw self.failure("Could not read shared file.") }
          let scoped = url.startAccessingSecurityScopedResource()
          defer { if scoped { url.stopAccessingSecurityScopedResource() } }
          let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
          guard values.isRegularFile == true else { throw self.failure("Share files rather than folders.") }
          let size = Int64(values.fileSize ?? 0)
          guard size <= self.remaining else { throw self.failure("Shared drafts can use up to 50 MB. Open or discard a saved share first.") }
          let suggested = provider.suggestedName.flatMap { $0.isEmpty ? nil : $0 } ?? url.lastPathComponent
          let name = (suggested as NSString).pathExtension.isEmpty && !url.pathExtension.isEmpty ? "\(suggested).\(url.pathExtension)" : suggested
          let destination = self.directory.appendingPathComponent("file-\(index)").appendingPathExtension(url.pathExtension)
          try FileManager.default.copyItem(at: url, to: destination)
          self.remaining -= size
          continuation.resume(returning: ["shareType": "file", "value": destination.absoluteString, "name": name,
            "mimeType": UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? UTType(identifier)?.preferredMIMEType ?? "application/octet-stream"])
        } catch { continuation.resume(throwing: error) }
      }
      if identifier == UTType.fileURL.identifier {
        provider.loadItem(forTypeIdentifier: identifier, options: nil) { item, error in copy(item as? URL, error) }
      } else { provider.loadFileRepresentation(forTypeIdentifier: identifier, completionHandler: copy) }
    }
  }
  @MainActor private func openParentApp() {
    guard let scheme = Bundle.main.object(forInfoDictionaryKey: "MainTargetUrlScheme") as? String,
      let url = URL(string: "\(scheme)://expo-sharing") else { return }
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication { application.open(url, options: [:], completionHandler: nil); break }
      responder = current.next
    }
    extensionContext?.completeRequest(returningItems: nil)
  }
}
