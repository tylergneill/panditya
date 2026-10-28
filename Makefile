# To update the Pandit data: see data/manual_cleaning.md.
# pandit_export: open the Pandit CSV export in the browser (babysat by hand, ~1.5-2 h).
# extract: export -> raw extract. Clean by hand. transform: cleaned extract -> entities.json.
# analyze: entities.json -> analysis_results/, including the Data Notes figures.

# pandit_export opens the Pandit export link, the one behind the "Download CSV"
# button on https://panditproject.org/search. Cloudflare demands a human check
# every ~15 min, so the rest is done by hand (about 1.5-2 h if babysat closely):
#
# 1. Pass the Cloudflare check. You land on a page like
#    https://panditproject.org/batch?id=26523&op=start with a progress bar. The
#    batch id is unique to your export. Keep the tab open, or the export stalls.
# 2. As of 22 Oct 2026, the server needs about 75 min of work. It only works while
#    that tab runs its JavaScript loop, and Cloudflare clearance runs out every
#    15 min, which breaks the loop: the progress bar is replaced by "An AJAX HTTP
#    error occurred. HTTP Result Code: 403". Refresh the page and pass the check
#    again; the export resumes where it stopped. Expect 5 or 6 refreshes.
#    Clearance can't be renewed early. A late refresh is fine, even hours late,
#    but after a week or two the server forgets the batch.
# 3. The progress bar runs to 100% twice: "Analyzing data..." (~45 min of work),
#    then "Exporting data..." (~30 min).
# 4. When it finishes, you are sent to /search with a green message at the bottom:
#    "Export complete. Download the file here." Don't left-click "here": the
#    site's script intercepts the click and errors. Right-click it, copy the link
#    address, and open that address in a tab (or right-click -> Save link as).
#    The download is instantaneous.
# 5. Bring the file in as described in data/manual_cleaning.md.
pandit_export:
	./pandit_export.sh

extract:
	python -m utils.extract

transform:
	python -m utils.transform

analyze:
	python -m utils.analyze

construct_full_graph:
	python -m utils.construct_full_graph

run:
	python flask_app.py