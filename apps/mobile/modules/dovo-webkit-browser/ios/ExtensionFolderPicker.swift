import UIKit
import UniformTypeIdentifiers

/// Presents the system folder picker for an unpacked extension. The returned URL is
/// security-scoped; the caller copies it into managed storage before using it.
@MainActor
final class ExtensionFolderPicker: NSObject, UIDocumentPickerDelegate {
  private static var active: ExtensionFolderPicker?
  private var continuation: CheckedContinuation<URL?, Never>?

  static func pick() async -> URL? {
    guard active == nil, #available(iOS 17.0, *), let presenter = BrowserEngine.shared.topViewController() else { return nil }
    let picker = ExtensionFolderPicker()
    active = picker
    return await withCheckedContinuation { continuation in
      picker.continuation = continuation
      let controller = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
      controller.allowsMultipleSelection = false
      controller.delegate = picker
      presenter.present(controller, animated: true)
    }
  }

  private func finish(_ url: URL?) {
    continuation?.resume(returning: url)
    continuation = nil
    Self.active = nil
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(urls.first) }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(nil) }
}
