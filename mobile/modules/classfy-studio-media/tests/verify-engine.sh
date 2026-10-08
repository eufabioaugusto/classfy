#!/bin/bash
set -euo pipefail

studio_test_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_test_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-fixtures.XXXXXX")"

ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30:d=2 -f lavfi -i sine=frequency=440:sample_rate=44100:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$studio_test_directory/red.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=180x320:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_test_directory/blue.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i sine=frequency=880:sample_rate=44100:duration=2 -c:a aac "$studio_test_directory/audio.m4a"
ffmpeg -hide_banner -loglevel error -display_rotation 90 -i "$studio_test_directory/red.mp4" -c copy "$studio_test_directory/rotated.mp4"

xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library "$studio_test_root/ios/StudioMediaEngine.swift" "$studio_test_root/tests/StudioMediaEngine.tests.swift" -o "$studio_test_directory/verify-engine"
"$studio_test_directory/verify-engine" "$studio_test_directory/red.mp4" "$studio_test_directory/blue.mp4" "$studio_test_directory/audio.m4a" "$studio_test_directory/rotated.mp4"
