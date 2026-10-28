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
3. **Set the version.** Put that date in `__pandit_data_version__` in
   `../VERSION`. Every script finds its files by this date.
4. **Extract.** `make extract` (or `python -m utils.extract`) keeps the
   Work and Person rows and the columns Pāṇḍitya uses, and writes
   `<date>-extracted-entities-raw.csv`.
5. **Clean** the raw extract as below, into
   `<date>-extracted-entities-cleaned.csv`.
6. **Transform.** `make transform` (or `python -m utils.transform`)
   writes `<date>-entities.json`, which the web app loads, and rebuilds
   `<seti date>-etext-link-data.json` from the SETI master, which fills the
   table on the SETI page.
7. **Analyze.** `make analyze` (or `python -m utils.analyze`) recomputes the
   network's components into `analysis_results/`, including
   `analysis_results/summary.json`, from which the Data Notes page takes all
   its figures. The app warns at startup if that summary is for an older
   date than `VERSION`.

The scripts need `pandas` (see `../requirements_etl.in`), e.g. in a local
`venv/`.

SETI reads the cleaned extract directly: its scripts take the newest
`data/*-extracted-entities-cleaned.csv` in this directory (not in
`archive/`), so step 1 matters there too.

## Updating the SETI data

The SETI master lives in the [seti](https://github.com/tylergneill/seti)
repository, as `data/seti-master.csv`, and is edited only there. Pāṇḍitya
uses a dated copy of it. To bring in a new one:

1. Delete the current `<date>-seti-master.csv` and
   `<date>-etext-link-data.json` here. The seti repository keeps earlier
   masters in its own `data/archive/`.
2. Copy `../seti/data/seti-master.csv` here as `<date>-seti-master.csv`,
   dated by the day of the copy.
3. Put that date in `__seti_data_version__` in `../VERSION`.
4. `make transform` writes `<date>-etext-link-data.json`, which fills the
   e-text links in the graph and the table on the SETI page.

Never edit the copy here: correct the master in seti and copy it again.

## Manual cleaning to get from raw to clean

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
  one in 2026-10-08)

These are better fixed in Pandit itself, so that later exports need less
of this. As of 2026-10-08 all of the above were still in the export.
