#!/bin/bash
set -euo pipefail
studio_audio_input_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_audio_input_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-audio-input.XXXXXX")"
trap 'rm -rf "$studio_audio_input_directory"' EXIT
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
xcrun swiftc -swift-version 6 -parse-as-library \
  "$studio_audio_input_root/ios/StudioCaptureAudioInput.swift" \
  "$studio_audio_input_root/tests/StudioCaptureAudioInputTests.swift" \
  -o "$studio_audio_input_directory/verify-audio-input"
"$studio_audio_input_directory/verify-audio-input"
