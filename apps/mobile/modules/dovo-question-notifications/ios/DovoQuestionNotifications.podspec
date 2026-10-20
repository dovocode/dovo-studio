Pod::Spec.new do |s|
  s.name = 'DovoQuestionNotifications'
  s.version = '1.0.0'
  s.summary = 'Background answers for Dovo question notifications'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Dovo'
  s.homepage = 'https://github.com/dovocode/dovo-studio'
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoNotifications'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift}'
end
