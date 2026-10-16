# clean the raw extract into the cleaned extract, which transform.py and SETI read
#
# This does what data/manual_cleaning.md used to describe as hand edits:
#   1. delete stray punctuation at the start of a field or list item (". Commentary on ...")
#   2. delete test records (any row mentioning "dummy")
#   3. delete records that are not works (bibliographic notes entered as works)
#   4. correct titles that carry a stray number
#   5. delete exact duplicate rows (the export repeats some blocks of rows)
#
# Records for steps 3 and 4 are listed below by ID. Add to them as new exports need.

import csv
import io
import os
import re
import sys

from utils.utils import get_pandit_data_version

PANDIT_DATA_VERSION = get_pandit_data_version()

current_file_dir = os.path.dirname(os.path.abspath(__file__))
relative_data_dir = "../data"

# a comma followed by one character that cannot begin a name, and an optional space
STRAY_PUNCTUATION = re.compile(r',[^\w,\n\'" \(\[-] ?')

NOT_WORKS = {
    "94687": "1 Edited e441.1.20",
    "94401": "1.2 Edited Ajmer 2008",
    "89073": "3 Edited and translated in Raffaele Torella, \"The Svabodhodayamañjarī, ...\"",
    "91797": "This is an Introduction by K.T.Pandurangi, ...",
}

TITLE_CORRECTIONS = {
    "92233": ("73.2 Mānameyodaya", "Mānameyodaya"),
}


def clean(input_path, output_path):
    with open(input_path, encoding="utf-8", newline="") as f:
        text = f.read()
    text = STRAY_PUNCTUATION.sub(",", text)
    header, *rows = list(csv.reader(io.StringIO(text)))

    counts = {"dummy": 0, "not a work": 0, "title corrected": 0, "duplicate": 0}
    kept, seen = [], set()
    for row in rows:
        if any("dummy" in cell.lower() for cell in row):
            counts["dummy"] += 1
            continue
        if row[1] in NOT_WORKS:
            counts["not a work"] += 1
            continue
        if row[1] in TITLE_CORRECTIONS and row[2] == TITLE_CORRECTIONS[row[1]][0]:
            row[2] = TITLE_CORRECTIONS[row[1]][1]
            counts["title corrected"] += 1
        if tuple(row) in seen:
            counts["duplicate"] += 1
            continue
        seen.add(tuple(row))
        kept.append(row)

    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(kept)

    print(f"{len(rows)} rows in, {len(kept)} out; removed or changed: {counts}")


if __name__ == "__main__":
    if len(sys.argv) == 3:
        clean(sys.argv[1], sys.argv[2])
    else:
        data_dir = os.path.join(current_file_dir, relative_data_dir)
        clean(os.path.join(data_dir, f"{PANDIT_DATA_VERSION}-extracted-entities-raw.csv"),
              os.path.join(data_dir, f"{PANDIT_DATA_VERSION}-extracted-entities-cleaned.csv"))
        print(f"Cleaned CSV saved as {PANDIT_DATA_VERSION}-extracted-entities-cleaned.csv")
