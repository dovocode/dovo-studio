import ExpoModulesCore
import UniformTypeIdentifiers
import UIKit

public class DovoFileDropModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DovoFileDrop")
    AsyncFunction("releaseFiles") { (uris: [String]) in
      for uri in uris {
        guard let url = URL(string: uri), url.isFileURL,
          url.deletingLastPathComponent().resolvingSymlinksInPath() == FileManager.default.temporaryDirectory.appendingPathComponent("dovo-file-drops").resolvingSymlinksInPath() else { continue }
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
      }
    }
    View(DovoFileDropView.self) {
      Events("onFilesDropped", "onDropActive", "onDropError")
      Prop("enabled") { (view: DovoFileDropView, enabled: Bool) in view.enabled = enabled }
    }
  }
}

class DovoFileDropView: ExpoView, UIDropInteractionDelegate {
  let onFilesDropped = EventDispatcher()
  let onDropActive = EventDispatcher()
  let onDropError = EventDispatcher()
  var enabled = true
  private var receiving = false
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIDropInteraction(delegate: self))
  }
  private func fileType(_ provider: NSItemProvider) -> String? {
    let contentType = provider.registeredTypeIdentifiers.first { identifier in
      guard let type = UTType(identifier) else { return false }
      return type.conforms(to: .data) && !type.conforms(to: .directory) && !type.conforms(to: .url)
    }
    return contentType ?? (provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) ? UTType.fileURL.identifier : nil)
  }
  private func loadFile(_ provider: NSItemProvider, type: String, completion: @escaping (URL?, Error?) -> Void) {
    if type == UTType.fileURL.identifier {
      provider.loadItem(forTypeIdentifier: type, options: nil) { item, error in completion(item as? URL, error) }
    } else { provider.loadFileRepresentation(forTypeIdentifier: type, completionHandler: completion) }
  }
  func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
    enabled && !receiving && session.items.contains { fileType($0.itemProvider) != nil }
  }
  func dropInteraction(_ interaction: UIDropInteraction, sessionDidEnter session: UIDropSession) {
    onDropActive(["active": true])
  }
  func dropInteraction(_ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal {
    UIDropProposal(operation: enabled && !receiving ? .copy : .forbidden)
  }
  func dropInteraction(_ interaction: UIDropInteraction, sessionDidExit session: UIDropSession) {
    onDropActive(["active": false])
  }
  func dropInteraction(_ interaction: UIDropInteraction, sessionDidEnd session: UIDropSession) {
    onDropActive(["active": false])
  }
  func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
    guard enabled && !receiving else { return }
    onDropActive(["active": false])
    let providers = session.items.map(\.itemProvider)
    guard providers.count <= 5 else {
      onDropError(["message": "Attach up to 5 files per message."])
      return
    }
    receiving = true
    let group = DispatchGroup()
    let lock = NSLock()
    var results: [(Int, [String: String])] = []
    var errors: [String] = []
    for (index, provider) in providers.enumerated() {
      guard let type = fileType(provider) else {
        lock.lock(); errors.append("This item is not a supported file."); lock.unlock()
        continue
      }
      group.enter()
      loadFile(provider, type: type) { url, error in
        defer { group.leave() }
        do {
          if let error { throw error }
          guard let url else { throw NSError(domain: "DovoFileDrop", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not read dropped file."]) }
          let scoped = url.startAccessingSecurityScopedResource()
          defer { if scoped { url.stopAccessingSecurityScopedResource() } }
          let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
          guard values.isRegularFile == true else { throw NSError(domain: "DovoFileDrop", code: 2, userInfo: [NSLocalizedDescriptionKey: "Drop files rather than directories."]) }
          let name = provider.suggestedName ?? url.lastPathComponent
          let contentType = (type == UTType.fileURL.identifier ? UTType(filenameExtension: url.pathExtension) : UTType(type))
          let isImage = contentType?.conforms(to: .image) == true || UTType(filenameExtension: (name as NSString).pathExtension)?.conforms(to: .image) == true
          // Match the JS optimizer's 50 MB source bound and the 5 MB upload bound.
          let maxBytes = (isImage ? 50 : 5) * 1024 * 1024
          guard (values.fileSize ?? 0) <= maxBytes else { throw NSError(domain: "DovoFileDrop", code: 3, userInfo: [NSLocalizedDescriptionKey: isImage ? "Choose an image up to 50 MB to optimize." : "Each attachment must be 5 MB or smaller."]) }
          let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dovo-file-drops", isDirectory: true)
          try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
          let target = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(url.pathExtension)
          try FileManager.default.copyItem(at: url, to: target)
          let result = ["uri": target.absoluteString, "name": name, "mimeType": contentType?.preferredMIMEType ?? "application/octet-stream"]
          lock.lock(); results.append((index, result)); lock.unlock()
        } catch {
          lock.lock(); errors.append(error.localizedDescription); lock.unlock()
        }
      }
    }
    group.notify(queue: .main) { [weak self] in
      self?.receiving = false
      guard let self, self.window != nil else {
        for (_, file) in results { if let uri = file["uri"], let url = URL(string: uri) { do { try FileManager.default.removeItem(at: url) } catch { NSLog("Could not remove abandoned drop: %@", error.localizedDescription) } } }
        return
      }
      if !results.isEmpty { self.onFilesDropped(["files": results.sorted { $0.0 < $1.0 }.map { $0.1 }]) }
      if !errors.isEmpty { self.onDropError(["message": errors.joined(separator: "\n")]) }
    }
  }
}
