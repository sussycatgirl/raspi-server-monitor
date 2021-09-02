#!/bin/bash

mkdir -p /dev/shm/streaming
rm -rf /dev/shm/streaming/*
ffmpeg \
  -i /dev/video0 \
  -input_format mjpeg \
  -f hls \
  -video_size 1920x1080 \
  -framerate 30 \
  -preset veryfast \
  -hls_init_time 0.1 \
  -hls_time 0.1 \
  -hls_playlist_type event \
  -hls_segment_type fmp4 \
  -sc_threshold 0 \
  -g 8 \
  -remove_at_exit 1 \
  -hls_wrap 3 \
  /dev/shm/streaming/stream.m3u8
