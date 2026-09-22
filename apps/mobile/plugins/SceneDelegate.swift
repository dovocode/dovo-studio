// Kept beside the config plugin so Expo prebuild reproduces native lifecycle support.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    // Expo Router reads its launch URL synchronously from Expo's lifecycle subscriber.
    // React Native's launch options alone do not populate that registry on SDK 57.
    if let context = options.urlContexts.first {
      launchOptions[.url] = context.url
      self.scene(scene, openURLContexts: [context])
    } else if let activity = options.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb }) {
      launchOptions[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity
      ]
    }
    for activity in options.userActivities {
      self.scene(scene, continue: activity)
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      _ = (UIApplication.shared.delegate as? AppDelegate)?.application(
        UIApplication.shared, open: context.url,
        options: [.sourceApplication: context.options.sourceApplication as Any,
                  .annotation: context.options.annotation as Any])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = (UIApplication.shared.delegate as? AppDelegate)?.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
