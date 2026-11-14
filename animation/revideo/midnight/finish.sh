#!/bin/sh
set -eu
python3 mix.py
ffmpeg -hide_banner -loglevel error -y -framerate 15 -i build/room_%04d.png -i build/overlay.mp4 -i build/mix.wav -filter_complex '[1:v]chromakey=0x00ff00:0.12:0.045[lettering];[0:v][lettering]overlay=shortest=1,format=yuv420p[out]' -map '[out]' -map 2:a -threads 2 -c:v libx264 -crf 19 -c:a aac -b:a 128k -movflags +faststart -shortest build/Thunder_Again.mp4
