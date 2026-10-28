#!/bin/bash
# Mixes music + VoiceStudio narration onto the silent render.
# Voice: VoiceStudio OmniVoice, instruct="female, young adult, low pitch", seed=42 (lines in voice/lines.txt).
set -euo pipefail
cd "$(dirname "$0")"
node music.mjs /tmp/forge3d-music.wav
# Start time (ms) of each line, aligned to the scene it narrates.
D=(500 4300 9300 14800 19500 24400)
ffmpeg -y -loglevel error -i forge3d-shark-demo-silent.mp4 -i /tmp/forge3d-music.wav \
  -i voice/vo1.wav -i voice/vo2.wav -i voice/vo3.wav -i voice/vo4.wav -i voice/vo5.wav -i voice/vo6.wav \
  -filter_complex "\
[2:a]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${D[0]}|${D[0]}[v1];\
[3:a]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${D[1]}|${D[1]}[v2];\
[4:a]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${D[2]}|${D[2]}[v3];\
[5:a]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${D[3]}|${D[3]}[v4];\
[6:a]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${D[4]}|${D[4]}[v5];\
[7:a]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${D[5]}|${D[5]}[v6];\
[v1][v2][v3][v4][v5][v6]amix=inputs=6:normalize=0,volume=1.1,asplit=2[vo][side];\
[1:a]volume=0.75[mus];\
[mus][side]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[duck];\
[duck][vo]amix=inputs=2:normalize=0,alimiter=limit=0.95,afade=t=out:st=26.8:d=0.2[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -t 27 -movflags +faststart forge3d-shark-demo.mp4
rm -f /tmp/forge3d-music.wav
