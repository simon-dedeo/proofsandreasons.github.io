#!/bin/sh
# Push the pages to the groth.lan.cmu.edu mirror (nginx root
# /opt/local/www/proofsandreasons). Pages (and the stylesheet and script the three
# host monitors share) only: every image except out.gif is
# loaded from an off-box URL, so rain_loop_frames and friends stay here.
set -e
cd "$(dirname "$0")"
rsync -av --no-perms --no-owner --no-group \
  index.html akdeniz.html wright.html ganesha.html monitor.css monitor.js \
  readings.html reddit-archive.html lesswrong-archive.html dashboard.html rh-oleans.html rh-graph.html vp-vnp-oleans.html vp-vnp-graph.html out.gif \
  gr:/opt/local/www/proofsandreasons/
