#!/usr/bin/env bash
# Generates the test videos used by the compat page into playground/public/compat/.
# Requires ffmpeg. Output is git-ignored. Re-run to regenerate.
set -euo pipefail

cd "$(dirname "$0")/public"
mkdir -p compat/hls
cd compat

SRC="../mire.mp4"
if [ ! -f "$SRC" ]; then
  echo "missing $SRC: generate the base mire first (see README of the playground)" >&2
  exit 1
fi

# Short clips with a keyframe every 2 s (25 fps => GOP 50) so seeking and
# HLS segmentation behave like real streams.
ENC=(-t 8 -c:v libx264 -preset veryfast -crf 24 -g 50 -keyint_min 50 -sc_threshold 0 -pix_fmt yuv420p -an)

echo "mp4 (progressive)"
ffmpeg -v error -y -i "$SRC" "${ENC[@]}" -movflags +faststart mire.mp4

echo "mp4 1080p (bench: decode and read cost scales with resolution)"
ffmpeg -v error -y -i mire.mp4 -vf scale=1920:1080 -t 8 -c:v libx264 -preset veryfast -crf 26 -g 50 -keyint_min 50 -sc_threshold 0 -pix_fmt yuv420p -an -movflags +faststart mire-1080.mp4

echo "webm (VP9)"
ffmpeg -v error -y -i "$SRC" -t 8 -c:v libvpx-vp9 -b:v 1M -an mire.webm

echo "fragmented mp4 (for MediaSource)"
ffmpeg -v error -y -i mire.mp4 -c copy -movflags frag_keyframe+empty_moov+default_base_moof mire-frag.mp4

echo "HLS (fMP4 segments, 2 s)"
ffmpeg -v error -y -i mire.mp4 -c copy -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename "hls/seg%d.m4s" hls/index.m3u8

echo "ClearKey-encrypted mp4 (EME test, NOT representative of Widevine)"
# key and kid are also hard-coded in compat-cases.ts
ffmpeg -v error -y -i mire.mp4 -c copy \
  -movflags frag_keyframe+empty_moov+default_base_moof \
  -encryption_scheme cenc-aes-ctr \
  -encryption_key 000102030405060708090a0b0c0d0e0f \
  -encryption_kid 101112131415161718191a1b1c1d1e1f mire-enc.mp4

ls -la . hls | head -30
