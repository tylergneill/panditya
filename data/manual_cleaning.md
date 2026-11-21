# Updating the Pandit data

Pāṇḍitya and SETI both read a static snapshot of the Pandit database. To
bring in a new export:

1. **Archive the current snapshot.** Move the current
   `<date>-pandit-entities-export.csv` and
   `<date>-extracted-entities-cleaned.csv` into `archive/`. Delete the
   current `<date>-extracted-entities-raw.csv` and `<date>-entities.json`:
   they are rebuilt from the other two.
2. **Copy in the new export** as `<date>-pandit-entities-export.csv`, dated
   by the day it was exported. `make pandit_export` starts one in the browser;
   it takes 1.5-2 hours of babysitting, as the recipe's comment in
   `../Makefile` explains.
3. **Set the version.** Put that date in `__pandit_source_version__` in
   `../VERSION`. Every script finds its files by this date.
4. **Extract.** `make extract` (or `python -m utils.extract`) keeps the
   Work and Person rows and the columns Pāṇḍitya uses, and writes
   `<date>-extracted-entities-raw.csv`.
5. **Clean.** `make clean` (or `python -m utils.clean`) makes the fixes listed below and
   writes `<date>-extracted-entities-cleaned.csv`, printing how many rows
   each fix touched.
6. **Transform.** `make transform` (or `python -m utils.transform`)
   writes `<date>-entities.json`, which the web app loads, and rebuilds
   `<seti date>-etext-link-data.json` from the SETI master, which fills the
   table on the SETI page.
7. **Analyze.** `make analyze` (or `python -m utils.analyze`) recomputes the
   network's components into `analysis_results/`, including
   `analysis_results/summary.json`, from which the Data Notes page takes all
   its figures. The app warns at startup if that summary is for an older
   date than `VERSION`.

`make pipeline` copies in the current SETI master (`make seti-import`,
below) and runs steps 4–6 in order (about a second); run `make analyze`
(about 8 seconds) after it, or use `make pipeline-analyze` for both.

The scripts need `pandas` (see `../requirements_etl.in`), e.g. in a local
`venv/`.

SETI takes its own copy of the cleaned extract (`make pandit-copy` in the
seti repository). Do these steps as step 1 of "Keeping Pāṇḍitya and SETI
in step" in `../README.md`, which says what SETI does next and when to
merge.

## Updating the SETI data

The SETI master lives in the [seti](https://github.com/tylergneill/seti)
repository, as `data/seti-master.csv`, and is edited only there. Pāṇḍitya
uses a dated copy of it, dated as seti dates it: seti's `VERSION` has
the day the master last changed, in `__seti_data_version__`.

`make seti-refresh` brings in a new one. It runs `make seti-import`,
which copies `../seti/data/seti-master.csv` to
`<date>-seti-master.csv`, puts that date in `__seti_source_version__` in
`../VERSION`, and deletes the previous dated master and
`<date>-etext-link-data.json` if the date changed. Then it runs
`make transform`, which writes `<date>-etext-link-data.json` for the
e-text links in the graph and the table on the SETI page. Restart the
server to see the result.

The date is right only for a committed master whose date seti has
updated, so `make seti-import` refuses one with uncommitted changes, or
one that `make master-date` in seti would redate; `FORCE=1` (e.g.
`make seti-refresh FORCE=1`) copies it anyway, to look at work in
progress.

Never edit the copy here: correct the master in seti and copy it again.

## Cleaning to get from raw to clean

`utils/clean.py` does all of this; its ID lists are where to add new
cases.

- delete `[^\w,\n'" \(\[-] ?` after `,` (stray punctuation at the start of a
  field, such as `. Commentary on ...` or `>Sphoṭavāda`)
- delete rows with "dummy" (test records), ignoring case
- delete a few incorrect works (actually scholarship)
  - Work,94687,1 Edited e441.1.20,,,87051,Suddhānanda Pathak,,,,,
  - Work,94401,1.2 Edited Ajmer 2008,,,86875,Bhagīratha Maithili Jhā,,,,,
  - Work,89073,"3 Edited and translated in Raffaele Torella, ""The Svabodhodayamañjarī, orhow to suppress the mind with no effort"", Haranandalahari 387-410",,,,,,,,,
  - Work,91797,"This is an Introduction by K.T.Pandurangi, excerpts from which comprise the summary provided at EIP 16, 2014, pp. 518-523",,,86105,Khaṇḍadeva,,,,,
- correct a title that carries a stray number
  - Work,92233: `73.2 Mānameyodaya` to `Mānameyodaya`
- delete duplicate rows (the export repeats some rows: 99 in 2025-11-07,
  one in 2026-10-08, none in 2026-10-31)

These are better fixed in Pandit itself, so that later exports need less
of this. As of 2026-10-31 all of the above except the duplicates were
still in the export.
