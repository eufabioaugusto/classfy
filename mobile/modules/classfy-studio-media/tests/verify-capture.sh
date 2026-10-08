#!/bin/bash
set -euo pipefail
studio_capture_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_capture_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-capture.XXXXXX")"
trap 'rm -rf "$studio_capture_directory"' EXIT
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
xcrun swiftc -swift-version 6 -parse-as-library \
  "$studio_capture_root/ios/StudioCaptureOperation.swift" \
  "$studio_capture_root/ios/StudioCaptureEffectConfirmation.swift" \
  "$studio_capture_root/tests/StudioCaptureOperationTests.swift" \
  -o "$studio_capture_directory/verify-capture"
"$studio_capture_directory/verify-capture"
