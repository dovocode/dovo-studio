Pod::Spec.new do |s|
  s.name = 'DovoFileDrop'
  s.version = '1.0.0'
  s.summary = 'Native file drop target for the Dovo composer'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Dovo'
  s.homepage = 'https://github.com/dovocode/dovo-studio'
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift}'
end
