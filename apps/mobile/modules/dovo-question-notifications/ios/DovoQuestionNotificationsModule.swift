import ExpoModulesCore
import ExpoNotifications
import Security
import UIKit
import UserNotifications

// Runs before React starts, including notification-action cold launches.
public class DovoQuestionNotificationsSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    NotificationCenterManager.shared.addDelegate(QuestionAnswers.shared)
    QuestionAnswers.registerCategories()
    return true
  }
}

public class DovoQuestionNotificationsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DovoQuestionNotifications")
    AsyncFunction("configure") { (json: String) in
      guard let data = json.data(using: .utf8),
        let value = try JSONSerialization.jsonObject(with: data) as? [String: [String: String]]
      else { throw QuestionError.invalid }
      try QuestionVault.write("connections", value)
    }
    AsyncFunction("getDraft") { (runtimeId: String, id: String) -> [String: Any]? in
      try QuestionVault.draft(runtimeId, id)
    }
    AsyncFunction("clearDraft") { (runtimeId: String, id: String) in
      try QuestionVault.saveDraft(runtimeId, id, nil)
    }
  }
}

private enum QuestionError: Error { case invalid, storage }

// Pairing credentials and unconfirmed answers remain on this device, unlocked only.
private enum QuestionVault {
  private static let lock = NSRecursiveLock()
  private static let service = "com.dovo.studio.question-notifications"
  private static func query(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }
  static func read(_ account: String) throws -> [String: Any] {
    lock.lock(); defer { lock.unlock() }
    var lookup = query(account)
    lookup[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecItemNotFound { return [:] }
    guard status == errSecSuccess, let data = result as? Data,
      let value = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw QuestionError.storage }
    return value
  }
  static func write(_ account: String, _ value: [String: Any]) throws {
    lock.lock(); defer { lock.unlock() }
    let data = try JSONSerialization.data(withJSONObject: value)
    let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
    let status = SecItemUpdate(query(account) as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      guard SecItemAdd(query(account).merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw QuestionError.storage }
    } else if status != errSecSuccess { throw QuestionError.storage }
  }
  static func draft(_ runtimeId: String, _ id: String) throws -> [String: Any]? {
    guard let draft = try read("drafts")[runtimeId + "\0" + id] as? [String: Any],
      let expires = draft["expires"] as? Double, expires > Date().timeIntervalSince1970 else { return nil }
    return draft
  }
  static func saveDraft(_ runtimeId: String, _ id: String, _ value: [String: Any]?) throws {
    lock.lock(); defer { lock.unlock() }
    var drafts = try read("drafts").filter { (_, value) in
      ((value as? [String: Any])?["expires"] as? Double ?? 0) > Date().timeIntervalSince1970
    }
    if value != nil, drafts[runtimeId + "\0" + id] == nil, drafts.count >= 20, let oldest = drafts.min(by: { (($0.value as? [String: Any])?["expires"] as? Double ?? 0) < (($1.value as? [String: Any])?["expires"] as? Double ?? 0) })?.key {
      drafts.removeValue(forKey: oldest)
    }
    drafts[runtimeId + "\0" + id] = value
    try write("drafts", drafts)
  }
}

private final class QuestionAnswers: NSObject, NotificationDelegate {
  static let shared = QuestionAnswers()
  private var pending = Set<String>() // All notification callbacks finish on the main queue.

  static func registerCategories() {
    let open = UNNotificationAction(identifier: "answer-question", title: "Open question", options: [.foreground])
    let reply = UNTextInputNotificationAction(identifier: "dovo-reply", title: "Reply", options: [.authenticationRequired], textInputButtonTitle: "Send", textInputPlaceholder: "Your answer")
    var categories: Set<UNNotificationCategory> = [UNNotificationCategory(identifier: "dovo-question-text", actions: [reply, open], intentIdentifiers: [])]
    for count in 1...3 {
      let choices = (0..<count).map { index in
        UNNotificationAction(identifier: "dovo-choice-\(index)", title: "Option \(index + 1)", options: [.authenticationRequired])
      }
      categories.insert(UNNotificationCategory(identifier: "dovo-question-choice-\(count)", actions: choices + [open], intentIdentifiers: []))
    }
    let installed = categories
    UNUserNotificationCenter.current().getNotificationCategories { existing in
      UNUserNotificationCenter.current().setNotificationCategories(existing.filter { !$0.identifier.hasPrefix("dovo-question-") }.union(installed))
    }
  }

  func didReceive(_ response: UNNotificationResponse, completionHandler: @escaping () -> Void) -> Bool {
    let action = response.actionIdentifier
    guard action == "dovo-reply" || action.hasPrefix("dovo-choice-") else { return false }
    if Thread.isMainThread { answer(response) }
    else { DispatchQueue.main.sync { self.answer(response) } }
    // Expo owns the completion callback. A UIKit background task keeps the request alive.
    return true
  }

  private func answer(_ response: UNNotificationResponse) {
    let content = response.notification.request.content
    let data = content.userInfo
    guard data["kind"] as? String == "input", data["inputType"] as? String == "question",
      let runtimeId = data["runtimeId"] as? String, let taskId = data["taskId"] as? String,
      let id = data["inputId"] as? String, let json = data["question"] as? String,
      let bytes = json.data(using: .utf8),
      let question = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
      let fieldId = question["fieldId"] as? String
    else { failure(content, response.notification.request.identifier, "Open Dovo to answer this question."); return }
    let value: String?
    if response.actionIdentifier == "dovo-reply", question["mode"] as? String == "text" {
      value = (response as? UNTextInputNotificationResponse)?.userText
    } else if question["mode"] as? String == "choice",
      let index = Int(response.actionIdentifier.replacingOccurrences(of: "dovo-choice-", with: "")),
      let choices = question["choices"] as? [[String: String]], choices.indices.contains(index) {
      value = choices[index]["value"]
    } else { value = nil }
    guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, value.utf16.count <= 10000 else {
      failure(content, response.notification.request.identifier, "Enter an answer in Dovo."); return
    }
    let key = runtimeId + "\0" + id
    guard pending.insert(key).inserted else { return }
    do {
      try QuestionVault.saveDraft(runtimeId, id, ["fieldId": fieldId, "value": value, "expires": Date().timeIntervalSince1970 + 86400])
      guard let connection = try QuestionVault.read("connections")[runtimeId] as? [String: String],
        let address = connection["address"], let token = connection["token"], !token.isEmpty,
        var components = URLComponents(string: address), ["http", "https"].contains(components.scheme ?? ""),
        components.host != nil, components.user == nil, components.password == nil
      else { throw QuestionError.invalid }
      components.path = "/api/notifications/answer"; components.query = nil; components.fragment = nil
      guard let url = components.url else { throw QuestionError.invalid }
      var request = URLRequest(url: url, timeoutInterval: 12)
      request.httpMethod = "POST"
      request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: ["taskId": taskId, "id": id, "fieldId": fieldId, "value": value])
      let transport = QuestionTransport()
      let session = URLSession(configuration: .ephemeral, delegate: transport, delegateQueue: nil)
      var background: UIBackgroundTaskIdentifier = .invalid
      background = UIApplication.shared.beginBackgroundTask(withName: "Answer Dovo question") { session.invalidateAndCancel() }
      session.dataTask(with: request) { body, result, error in
        DispatchQueue.main.async {
          defer {
            self.pending.remove(key)
            session.finishTasksAndInvalidate()
            if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
          }
          let status = (result as? HTTPURLResponse)?.statusCode
          let ok = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["ok"] as? Bool == true
          if error == nil, status == 200, ok {
            do { try QuestionVault.saveDraft(runtimeId, id, nil) }
            catch { self.failure(content, response.notification.request.identifier, "Answer sent. Open Dovo to refresh this question.") }
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [response.notification.request.identifier])
          } else {
            self.failure(content, response.notification.request.identifier, status == 409 ? "Question changed or already answered. Open Dovo to check." : "Answer not confirmed. Open Dovo to review and send again.")
          }
        }
      }.resume()
    } catch {
      pending.remove(key)
      failure(content, response.notification.request.identifier, "Answer not sent. Open Dovo to check your connection.")
    }
  }

  private func failure(_ content: UNNotificationContent, _ id: String, _ message: String) {
    guard let next = content.mutableCopy() as? UNMutableNotificationContent else { return }
    next.title = "Dovo · Answer needs attention"
    next.body = message
    next.categoryIdentifier = "dovo-question"
    next.sound = nil
    // Keep exact runtime/thread/question identity; remove direct actions to prevent blind retries.
    next.userInfo.removeValue(forKey: "question")
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: next, trigger: nil))
  }
}

private final class QuestionTransport: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil) // Never forward the paired credential to a redirected destination.
  }
}
