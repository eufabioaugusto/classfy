#!/bin/bash
set -euo pipefail
studio_audio_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_audio_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-audio.XXXXXX")"
trap 'rm -rf "$studio_audio_directory"' EXIT
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
xcrun swiftc -swift-version 5 -parse-as-library \
  "$studio_audio_root/ios/StudioCaptureAudioMonitor.swift" \
  "$studio_audio_root/tests/StudioCaptureAudioMonitorTests.swift" \
  -o "$studio_audio_directory/verify-capture-audio"
"$studio_audio_directory/verify-capture-audio"
