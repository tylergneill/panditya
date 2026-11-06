#!/bin/bash
# Open the Pandit "Download CSV" export in the browser. The rest is by hand: see the
# pandit_export recipe in the Makefile.

EXPORT_URL="https://panditproject.org/search/pandit-entities-export?page&_format=csv"

if command -v open >/dev/null; then
  open "$EXPORT_URL"
elif command -v xdg-open >/dev/null; then
  xdg-open "$EXPORT_URL"
else
  echo "Open this in your browser: $EXPORT_URL"
fi

echo "Pandit export opened. Pass the Cloudflare check, keep the tab open, and refresh"
echo "it whenever a 403 replaces the progress bar (every ~15 min, for ~75 min of work)."
echo "Full steps: the pandit_export comment in the Makefile."
