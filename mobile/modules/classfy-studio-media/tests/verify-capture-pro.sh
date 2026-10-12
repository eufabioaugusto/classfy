#!/bin/bash
set -euo pipefail
studio_pro_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_pro_temp="$(mktemp -d "${TMPDIR:-/tmp}/classfy-capture-pro.XXXXXX")"
trap 'rm -rf "$studio_pro_temp"' EXIT
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=green:s=3840x2160:r=24:d=0.5 -f lavfi -i sine=frequency=440:sample_rate=44100:duration=0.5 -c:v libx264 -preset ultrafast -threads 2 -crf 35 -pix_fmt yuv420p -c:a aac -shortest "$studio_pro_temp/4k24.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=2160x3840:r=60:d=0.3 -f lavfi -i sine=frequency=880:sample_rate=44100:duration=0.3 -c:v libx264 -preset ultrafast -threads 2 -crf 35 -pix_fmt yuv420p -c:a aac -shortest "$studio_pro_temp/portrait4k60.mp4"
ffmpeg -hide_banner -loglevel error -display_rotation 90 -i "$studio_pro_temp/4k24.mp4" -c copy "$studio_pro_temp/rotated4k24.mov"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=1920x1080:r=30:d=0.2 -c:v libx264 -preset ultrafast -threads 2 -pix_fmt yuv420p "$studio_pro_temp/1080.mp4"
xcrun swiftc -swift-version 5 -parse-as-library "$studio_pro_root/ios/StudioCaptureDownsample.swift" "$studio_pro_root/tests/StudioCaptureDownsampleTests.swift" -o "$studio_pro_temp/verify-pro"
"$studio_pro_temp/verify-pro" "$studio_pro_temp/4k24.mp4" "$studio_pro_temp/portrait4k60.mp4" "$studio_pro_temp/rotated4k24.mov" "$studio_pro_temp/1080.mp4"
xcrun swiftc -swift-version 5 -parse-as-library "$studio_pro_root/ios/StudioCameraProControls.swift" "$studio_pro_root/tests/StudioCameraProControlsTests.swift" -o "$studio_pro_temp/verify-gains"
"$studio_pro_temp/verify-gains"
# Typecheck the actual iOS AVFoundation APIs without opening a capture device.
xcrun swiftc -swift-version 5 -typecheck -target arm64-apple-ios15.1-simulator -sdk "$(xcrun --show-sdk-path --sdk iphonesimulator)" "$studio_pro_root/ios/StudioCameraProControls.swift"
