# copy the SETI master in from ../seti, under the date SETI gives it
#
# SETI's VERSION dates the master (__seti_data_version__, the day of the
# last commit that changed it, set by make master-date there). This copies
# ../seti/data/seti-master.csv as it is on disk to data/<that date>-seti-master.csv
# and puts the date in __seti_source_version__ here. If the date has changed,
# the old dated master and its etext-link-data.json are deleted: make transform
# rebuilds the latter.
#
# The date is right only for a committed master whose date seti has updated
# (make master-date there), so this refuses to copy otherwise, unless given
# --force (make seti-import FORCE=1).

import os
import re
import shutil
import subprocess
import sys

from utils.utils import VERSION_FILEPATH, get_seti_source_version

SETI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../seti")
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../data")
MASTER = "data/seti-master.csv"


def main():
    with open(os.path.join(SETI_DIR, "VERSION"), encoding="utf-8") as f:
        found = re.search(r'^__seti_data_version__\s*=\s*["\']([^"\']+)["\']', f.read(), re.M)
    if not found:
        sys.exit("No __seti_data_version__ in ../seti/VERSION.")
    new = found.group(1)
    old = get_seti_source_version()

    problems = []
    status = subprocess.run(["git", "-C", SETI_DIR, "status", "--porcelain", "--", MASTER],
                            capture_output=True, text=True, check=True).stdout
    if status:
        problems.append(f"../seti/{MASTER} has uncommitted changes: commit them in seti, then run make master-date there.")
    else:
        # seti's own check that VERSION's date is the master's last commit
        dated = subprocess.run([sys.executable, os.path.join(SETI_DIR, "scripts/master_date.py"), "--check"],
                               capture_output=True, text=True)
        if dated.returncode:
            problems.append(dated.stderr.strip() + " (in seti)")
    if problems:
        if "--force" not in sys.argv[1:]:
            sys.exit(f"Not copying: the date {new} may not describe the master.\n  " + "\n  ".join(problems)
                     + "\nOr copy anyway with --force (make ... FORCE=1).")
        print(f"--force: copying under {new} anyway.\n  " + "\n  ".join(problems))

    if new != old:
        for name in (f"{old}-seti-master.csv", f"{old}-etext-link-data.json"):
            path = os.path.join(DATA_DIR, name)
            if os.path.exists(path):
                os.remove(path)
                print(f"Removed {name}")

    shutil.copyfile(os.path.join(SETI_DIR, MASTER), os.path.join(DATA_DIR, f"{new}-seti-master.csv"))
    print(f"Copied the SETI master as {new}-seti-master.csv")

    with open(VERSION_FILEPATH, encoding="utf-8") as f:
        text = f.read()
    text = re.sub(r'^__seti_source_version__\s*=\s*["\'][^"\']*["\']',
                  f'__seti_source_version__ = "{new}"', text, flags=re.M)
    with open(VERSION_FILEPATH, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"__seti_source_version__ = {new}")


if __name__ == "__main__":
    main()
