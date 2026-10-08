#!/bin/bash
set -euo pipefail

studio_test_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_test_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-fixtures.XXXXXX")"

ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30:d=2 -f lavfi -i sine=frequency=440:sample_rate=44100:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$studio_test_directory/red.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=180x320:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_test_directory/blue.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i sine=frequency=880:sample_rate=44100:duration=2 -c:a aac "$studio_test_directory/audio.m4a"
ffmpeg -hide_banner -loglevel error -display_rotation 90 -i "$studio_test_directory/red.mp4" -c copy "$studio_test_directory/rotated.mp4"
# A few flat-color frames exercise real UHD encoders without a long/heavy fixture.
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=green:s=3840x2160:r=24:d=0.5 -c:v libx264 -preset ultrafast -threads 2 -crf 35 -pix_fmt yuv420p "$studio_test_directory/4k24.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=green:s=3840x2160:r=60:d=0.25 -c:v libx264 -preset ultrafast -threads 2 -crf 35 -pix_fmt yuv420p "$studio_test_directory/4k60.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=purple:s=320x180:r=25:d=0.32 -c:v libx264 -preset ultrafast -threads 2 -pix_fmt yuv420p "$studio_test_directory/25fps.mp4"

xcrun swiftc -D STUDIO_MEDIA_TEST -swift-version 5 -suppress-warnings -parse-as-library "$studio_test_root/ios/StudioMediaEngine.swift" "$studio_test_root/tests/StudioMediaEngine.tests.swift" -o "$studio_test_directory/verify-engine"
"$studio_test_directory/verify-engine" "$studio_test_directory/red.mp4" "$studio_test_directory/blue.mp4" "$studio_test_directory/audio.m4a" "$studio_test_directory/rotated.mp4" "$studio_test_directory/4k24.mp4" "$studio_test_directory/4k60.mp4" "$studio_test_directory/25fps.mp4"
