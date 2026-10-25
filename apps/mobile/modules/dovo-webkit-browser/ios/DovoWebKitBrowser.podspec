Pod::Spec.new do |s|
  s.name = 'DovoWebKitBrowser'
  s.version = '1.0.0'
  s.summary = 'Native WKWebView browser tabs, named profiles and WKWebExtension support for Dovo'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Dovo'
  s.homepage = 'https://github.com/dovocode/dovo-studio'
  # Browsing needs iOS 17 and extensions iOS 18.4; both are gated at runtime.
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WebKit', 'UniformTypeIdentifiers'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift}'
end
