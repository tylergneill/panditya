# Updating the Pandit data

Pāṇḍitya and SETI both read a static snapshot of the Pandit database. To
bring in a new export:

1. **Archive the current snapshot.** Move the current
   `<date>-pandit-entities-export.csv` and
   `<date>-extracted-entities-cleaned.csv` into `archive/`. Delete the
   current `<date>-extracted-entities-raw.csv` and `<date>-entities.json`:
   they are rebuilt from the other two.
2. **Copy in the new export** as `<date>-pandit-entities-export.csv`, dated
   by the day it was exported.
3. **Set the version.** Put that date in `__pandit_data_version__` in
   `../VERSION`. Every script finds its files by this date.
4. **Extract.** `make extract` (or `python -m utils.extract`) keeps the
   Work and Person rows and the columns Pāṇḍitya uses, and writes
   `<date>-extracted-entities-raw.csv`.
5. **Clean** the raw extract as below, into
   `<date>-extracted-entities-cleaned.csv`.
6. **Transform.** `make transform` (or `python -m utils.transform`)
   writes `<date>-entities.json`, which the web app loads.

The scripts need `pandas` (see `../requirements_etl.in`), e.g. in a local
`venv/`.

SETI reads the cleaned extract directly: its scripts take the newest
`data/*-extracted-entities-cleaned.csv` in this directory (not in
`archive/`), so step 1 matters there too.

The SETI layer (`<date>-seti-master.csv` and `<date>-etext-link-data.json`)
has its own date, `__seti_data_version__`, and is updated separately.

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
