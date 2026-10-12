#!/bin/bash
set -euo pipefail
studio_preview_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_preview_temp="$(mktemp -d "${TMPDIR:-/tmp}/classfy-capture-preview.XXXXXX")"
trap 'rm -rf "$studio_preview_temp"' EXIT
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun swiftc -swift-version 5 -parse-as-library "$studio_preview_root/ios/StudioCapturePreviewProfile.swift" "$studio_preview_root/tests/StudioCapturePreviewProfileTests.swift" -o "$studio_preview_temp/verify-preview"
"$studio_preview_temp/verify-preview"
