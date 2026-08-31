#!/bin/sh
# Push the pages to the groth.lan.cmu.edu mirror (nginx root
# /opt/local/www/proofsandreasons). Pages only: every image except out.gif is
# loaded from an off-box URL, so rain_loop_frames and friends stay here.
set -e
cd "$(dirname "$0")"
rsync -av --no-perms --no-owner --no-group \
  index.html akdeniz.html readings.html reddit-archive.html dashboard.html out.gif \
  gr:/opt/local/www/proofsandreasons/
