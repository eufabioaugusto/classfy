#!/bin/bash
set -euo pipefail
studio_speech_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_speech_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-speech.XXXXXX")"
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_speech_root/ios/StudioEffectRenderer.swift" \
  "$studio_speech_root/ios/StudioVideoCompositor.swift" \
  "$studio_speech_root/ios/StudioRecipeVisualEffects.swift" "$studio_speech_root/ios/StudioRecipeEngine.swift" \
  "$studio_speech_root/ios/StudioTranscription.swift" \
  "$studio_speech_root/tests/StudioTranscription.tests.swift" \
  -o "$studio_speech_directory/verify-transcription"
"$studio_speech_directory/verify-transcription"
