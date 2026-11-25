#!/usr/bin/env bash
# Regenerates the test clips (needs ffmpeg; CI does not: the clips are committed).
#
# Each clip is 4 s at 25 fps with a gray center and a 20 % strip on every side.
# First 2 s: left red, right blue, top green, bottom yellow.
# Last 2 s:  left blue, right red, top yellow, bottom green (so a change is visible).
#
# Encoded in BT.709 AND tagged as such, like a real HD video: an untagged clip is
# decoded with a different matrix per browser and the colors drift (up to 49/255
# on Safari), which would make these tests measure the clip, not the library.
set -euo pipefail
cd "$(dirname "$0")/public"

strips() { # width height left right top bottom
  echo "drawbox=x=0:y=0:w=iw*0.2:h=ih:color=$3:t=fill,drawbox=x=iw*0.8:y=0:w=iw*0.2:h=ih:color=$4:t=fill,drawbox=x=0:y=0:w=iw:h=ih*0.2:color=$5:t=fill,drawbox=x=0:y=ih*0.8:w=iw:h=ih*0.2:color=$6:t=fill"
}

for size in "640 360" "1920 1080" "3840 2160"; do
  set -- $size
  w=$1; h=$2
  ffmpeg -v error -y \
    -f lavfi -i "color=c=0x808080:s=${w}x${h}:r=25:d=2,$(strips "$w" "$h" 0xff0000 0x0000ff 0x00c800 0xffff00)" \
    -f lavfi -i "color=c=0x808080:s=${w}x${h}:r=25:d=2,$(strips "$w" "$h" 0x0000ff 0xff0000 0xffff00 0x00c800)" \
    -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
    -c:v libvpx-vp9 -b:v 2M -deadline realtime -cpu-used 8 -row-mt 1 -an "quad-${h}.webm"
done
ls -la

# shift-360.webm: the whole frame is one color, red for 2 s then blue for 2 s.
# Unlike quad-*, the picture's overall colors change (quad only swaps its strips).
ffmpeg -v error -y \
  -f lavfi -i "color=c=0xc83c3c:s=640x360:r=25:d=2" \
  -f lavfi -i "color=c=0x3c3cc8:s=640x360:r=25:d=2" \
  -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:v libvpx-vp9 -b:v 1M -deadline realtime -cpu-used 8 -row-mt 1 -an "shift-360.webm"
ls -la

