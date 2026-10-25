import Foundation

struct BrowserError: LocalizedError {
  let code: String
  let message: String
  var errorDescription: String? { message }

  static func invalid(_ message: String) -> BrowserError { BrowserError(code: "ERR_INVALID_ARGUMENT", message: message) }
  static func notFound(_ message: String) -> BrowserError { BrowserError(code: "ERR_NOT_FOUND", message: message) }
  static let disabled = BrowserError(code: "ERR_DISABLED", message: "The WebKit browser is turned off.")
  static let unsupported = BrowserError(code: "ERR_UNSUPPORTED", message: "This iOS version does not support the WebKit browser features required for this call.")
}

enum BrowserLimits {
  /// Matches the UI cap. Background tabs whose content process iOS reclaims reload when shown.
  static let maxTabs = 100
  static let maxProfiles = 16
  static let maxExtensionsPerProfile = 32
  static let maxUrlLength = 8192
  static let selectionLimit = 32_000
  static let selectionTimeout: TimeInterval = 3
  static let permissionPromptTimeout: TimeInterval = 60
  static let maxExtensionFiles = 5000
  static let maxExtensionBytes = 64 * 1024 * 1024
  static let maxExtensionDepth = 24
}

enum BrowserInput {
  static func id(_ value: String, _ field: String) throws -> String {
    guard (1...64).contains(value.utf8.count),
      value.utf8.allSatisfy({ byte in
        (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte) || byte == 45 || byte == 95
      })
    else { throw BrowserError.invalid("\(field) must be 1-64 letters, digits, '-' or '_'.") }
    return value
  }

  /// URLs JS may load into a tab: http and https (HTTP stays supported for LAN/VPN) or about:blank.
  static func pageURL(_ value: String) throws -> URL {
    guard value.utf16.count <= BrowserLimits.maxUrlLength, let url = URL(string: value), let scheme = url.scheme?.lowercased()
    else { throw BrowserError.invalid("Enter a valid http, https or about:blank URL.") }
    if scheme == "about", value.lowercased() == "about:blank" { return url }
    guard scheme == "http" || scheme == "https", let host = url.host, !host.isEmpty, url.user == nil, url.password == nil
    else { throw BrowserError.invalid("Only http, https and about:blank URLs can be opened.") }
    return url
  }

  static func strings(_ values: [String], _ field: String, limit: Int = 256) throws -> [String] {
    guard values.count <= limit, values.allSatisfy({ !$0.isEmpty && $0.utf16.count <= 2048 })
    else { throw BrowserError.invalid("\(field) contains too many or invalid entries.") }
    return Array(Set(values)).sorted()
  }
}

/// Clamps to `limit` UTF-16 code units without leaving a lone high surrogate.
func clampSelection(_ text: String, limit: Int = BrowserLimits.selectionLimit) -> (String, Bool) {
  let units = Array(text.utf16)
  guard units.count > limit else { return (text, false) }
  var end = limit
  if end > 0, UTF16.isLeadSurrogate(units[end - 1]) { end -= 1 }
  return (String(decoding: units[0..<end], as: UTF16.self), true)
}

struct ProfileRecord: Codable {
  var profileId: String
  var dataStoreIdentifier: UUID
}

struct ExtensionRecord: Codable {
  var extensionId: String
  var profileId: String
  /// Host of the stable webkit-extension:// base URL, so extension origins survive restarts.
  var baseHost: String
  var name: String
  var version: String?
  var description: String?
  var manifestVersion: Double
  var enabled: Bool
  var grantedPermissions: [String]
  var grantedMatchPatterns: [String]
  var requestedPermissions: [String]
  var optionalPermissions: [String]
  var requestedMatchPatterns: [String]
  var optionalMatchPatterns: [String]
  var unsupportedPermissions: [String]
  var installedAt: Date
}

/// Disk layout under Application Support/DovoWebKitBrowser:
/// profiles.json, staging/<stagingId>/, extensions/<profileId>/<extensionId>/{record.json,bundle/}.
final class BrowserStorage {
  let root: URL
  private let fileManager = FileManager.default

  init(root: URL? = nil) {
    self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("DovoWebKitBrowser", isDirectory: true)
  }

  var stagingRoot: URL { root.appendingPathComponent("staging", isDirectory: true) }
  func stagingURL(_ id: String) -> URL { stagingRoot.appendingPathComponent(id, isDirectory: true) }
  func profileExtensionsURL(_ profileId: String) -> URL {
    root.appendingPathComponent("extensions", isDirectory: true).appendingPathComponent(profileId, isDirectory: true)
  }
  func extensionURL(_ profileId: String, _ extensionId: String) -> URL {
    profileExtensionsURL(profileId).appendingPathComponent(extensionId, isDirectory: true)
  }
  func bundleURL(_ profileId: String, _ extensionId: String) -> URL {
    extensionURL(profileId, extensionId).appendingPathComponent("bundle", isDirectory: true)
  }

  func ensureDirectory(_ url: URL) throws {
    try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutable = root
    try mutable.setResourceValues(values)
  }

  private func missing(_ error: Error) -> Bool {
    let error = error as NSError
    return (error.domain == NSCocoaErrorDomain && (error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError)) ||
      (error.domain == NSPOSIXErrorDomain && error.code == 2)
  }

  func loadProfiles() throws -> [String: ProfileRecord] {
    let data: Data
    do { data = try Data(contentsOf: root.appendingPathComponent("profiles.json")) }
    catch { if missing(error) { return [:] }; throw error }
    let records = try JSONDecoder().decode([ProfileRecord].self, from: data)
    guard records.count <= BrowserLimits.maxProfiles else { throw BrowserError.invalid("Saved profile catalogue exceeds the profile limit.") }
    var result: [String: ProfileRecord] = [:]
    var identifiers = Set<UUID>()
    for record in records {
      _ = try BrowserInput.id(record.profileId, "saved profileId")
      guard result[record.profileId] == nil, identifiers.insert(record.dataStoreIdentifier).inserted else {
        throw BrowserError.invalid("Saved profile catalogue contains duplicate identities.")
      }
      result[record.profileId] = record
    }
    return result
  }

  func saveProfiles(_ profiles: [String: ProfileRecord]) throws {
    try ensureDirectory(root)
    let data = try JSONEncoder().encode(profiles.values.sorted { $0.profileId < $1.profileId })
    try data.write(to: root.appendingPathComponent("profiles.json"), options: .atomic)
  }

  func loadExtensions(_ profileId: String) throws -> [ExtensionRecord] {
    _ = try BrowserInput.id(profileId, "profileId")
    let directory = profileExtensionsURL(profileId)
    let entries: [URL]
    do { entries = try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey]) }
    catch { if missing(error) { return [] }; throw error }
    guard entries.count <= BrowserLimits.maxExtensionsPerProfile else { throw BrowserError.invalid("Saved extensions exceed the profile limit.") }
    var records: [ExtensionRecord] = []
    var ids = Set<String>()
    for entry in entries {
      let id = try BrowserInput.id(entry.lastPathComponent, "saved extension path")
      let values = try entry.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
      guard values.isSymbolicLink != true, values.isDirectory == true else { throw BrowserError.invalid("Invalid saved extension directory.") }
      let recordURL = entry.appendingPathComponent("record.json")
      let recordValues = try recordURL.resourceValues(forKeys: [.isSymbolicLinkKey])
      guard recordValues.isSymbolicLink != true else { throw BrowserError.invalid("Invalid saved extension record.") }
      let record = try JSONDecoder().decode(ExtensionRecord.self, from: Data(contentsOf: recordURL))
      _ = try BrowserInput.id(record.extensionId, "saved extensionId")
      _ = try BrowserInput.id(record.profileId, "saved extension profileId")
      guard record.extensionId == id, record.profileId == profileId, ids.insert(id).inserted,
        UUID(uuidString: record.baseHost) != nil else { throw BrowserError.invalid("Saved extension identity does not match its directory.") }
      records.append(record)
    }
    return records.sorted { $0.installedAt < $1.installedAt }
  }

  func saveExtension(_ record: ExtensionRecord) throws {
    let directory = extensionURL(record.profileId, record.extensionId)
    try ensureDirectory(directory)
    try JSONEncoder().encode(record).write(to: directory.appendingPathComponent("record.json"), options: .atomic)
  }

  func remove(_ url: URL) throws {
    do { try fileManager.removeItem(at: url) }
    catch { if !missing(error) { throw error } }
  }

  /// Copies an unpacked extension into `destination`, rejecting symlinks, special files and
  /// oversized trees. Accepts a folder whose single child folder holds manifest.json.
  func copyExtensionFolder(from source: URL, to destination: URL) throws {
    var source = source.standardizedFileURL.resolvingSymlinksInPath()
    if !fileManager.fileExists(atPath: source.appendingPathComponent("manifest.json").path) {
      let children = (try? fileManager.contentsOfDirectory(at: source, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
      let folders = children.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
      guard children.count == 1, let only = folders.first, fileManager.fileExists(atPath: only.appendingPathComponent("manifest.json").path)
      else { throw BrowserError.invalid("Choose an unpacked extension folder that contains manifest.json.") }
      source = only
    }
    let keys: [URLResourceKey] = [.isDirectoryKey, .isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
    guard let enumerator = fileManager.enumerator(at: source, includingPropertiesForKeys: keys, options: [])
    else { throw BrowserError.invalid("Could not read the extension folder.") }
    try remove(destination)
    try ensureDirectory(destination)
    var files = 0
    var bytes = 0
    let basePath = source.path.hasSuffix("/") ? source.path : source.path + "/"
    do {
      for case let item as URL in enumerator {
        let values = try item.resourceValues(forKeys: Set(keys))
        guard item.path.hasPrefix(basePath) else { throw BrowserError.invalid("The extension folder contains entries outside itself.") }
        let relative = String(item.path.dropFirst(basePath.count))
        guard enumerator.level <= BrowserLimits.maxExtensionDepth else { throw BrowserError.invalid("The extension folder is nested too deeply.") }
        if values.isSymbolicLink == true { throw BrowserError.invalid("Extension folders cannot contain symbolic links (\(relative)).") }
        let target = destination.appendingPathComponent(relative)
        if values.isDirectory == true {
          try fileManager.createDirectory(at: target, withIntermediateDirectories: true)
        } else if values.isRegularFile == true {
          files += 1
          bytes += values.fileSize ?? 0
          guard files <= BrowserLimits.maxExtensionFiles, bytes <= BrowserLimits.maxExtensionBytes
          else { throw BrowserError.invalid("Extensions are limited to \(BrowserLimits.maxExtensionFiles) files and 64 MB.") }
          try fileManager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
          try fileManager.copyItem(at: item, to: target)
        } else {
          throw BrowserError.invalid("Extension folders can only contain files and folders (\(relative)).")
        }
      }
    } catch {
      do { try remove(destination) }
      catch let cleanup { throw BrowserError(code: "ERR_STORAGE", message: "\(error.localizedDescription) Cleanup failed: \(cleanup.localizedDescription)") }
      throw error
    }
  }
}
