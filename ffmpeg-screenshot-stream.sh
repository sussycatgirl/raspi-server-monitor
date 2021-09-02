#!/bin/bash

ffmpeg -y -i /dev/shm/streaming/stream.m3u8 -ss 1 -frames:v 1 /dev/shm/streaming/screenshot.png
