Pod::Spec.new do |s|
  s.name = 'ClassfyStudioMedia'
  s.version = '1.0.0'
  s.summary = 'Mídia e controles de câmera nativos do Studio Classfy'
  s.description = 'Captura AVFoundation, composição Metal, camadas, tratamento de imagem e transcrição local do Studio Classfy.'
  s.license = { :type => 'Proprietary' }
  s.author = 'Classfy'
  s.homepage = 'https://classfy.com.br'
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoCamera'
  s.frameworks = 'AVFoundation', 'ImageIO', 'CoreGraphics', 'UniformTypeIdentifiers', 'CoreImage', 'Metal', 'MetalKit', 'CoreText', 'CoreVideo', 'Speech', 'Vision', 'VideoToolbox'
  # ExpoCamera imports the two ZXing subspecs. Its public module must be read
  # with the same defines, otherwise ZXing's umbrella asks for unused headers.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) ZXINGOBJC_USE_SUBSPECS ZXINGOBJC_PDF417 ZXINGOBJC_ONED'
  }
  s.source_files = '**/*.{h,m,swift}'
end
