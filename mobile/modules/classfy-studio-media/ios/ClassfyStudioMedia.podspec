Pod::Spec.new do |s|
  s.name = 'ClassfyStudioMedia'
  s.version = '1.0.0'
  s.summary = 'Exportação nativa do Studio Classfy'
  s.description = 'Composição, cortes, metadados e capas de mídia local usando AVFoundation.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Classfy'
  s.homepage = 'https://classfy.com.br'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'ImageIO', 'CoreGraphics', 'UniformTypeIdentifiers'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
