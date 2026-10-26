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
  static let maxUrlLength = 8192
  static let selectionLimit = 32_000
  static let selectionTimeout: TimeInterval = 3
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

final class BrowserStorage {
  let root: URL
  private let fileManager = FileManager.default

  init(root: URL? = nil) {
    self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("DovoWebKitBrowser", isDirectory: true)
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

  func remove(_ url: URL) throws {
    do { try fileManager.removeItem(at: url) }
    catch { if !missing(error) { throw error } }
  }
}
