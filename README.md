# Pāṇḍitya

Graphs person-work and work-work relationships in the [Pandit Prosophographical Database of Indic Texts](https://www.panditproject.org/).

This can be useful both for exploring certain persons or works of interest and for more quickly finding Pandit items in need of improvement.

You can also learn about and navigate to online e-texts through the SETI layer of the project. Right-click on work nodes for this and other options.

# Web app

Currently deployed at https://panditya.info.

See the [about page](https://panditya.info/about) for more info.

# Offline mode

It's also possible to use the backend code locally to produce graph data for use with e.g. [Gephi](https://gephi.org/).
Resulting graphs are created in memory, (optionally) drawn to the screen with `networkx`, and also (optionally) output for Gephi.
This makes it feasible to visualize the entire graph at once, among other things.
For more details, see [offline_mode.md](https://github.com/tylergneill/panditya/tree/main/offline_mode.md).

# Updating the data

The Pandit snapshot and a copy of the [SETI](https://github.com/tylergneill/seti) master live in `data/`,
each dated, with the current dates in `VERSION`. The steps for each are in
[data/manual_cleaning.md](data/manual_cleaning.md).

## Keeping Pāṇḍitya and SETI in step

Each repo keeps a dated copy of the other's data: Pāṇḍitya a copy of the
SETI master, SETI a copy of Pāṇḍitya's cleaned Pandit extract. Pāṇḍitya's
`VERSION` records when the Pandit data was sourced
(`__pandit_content_version__`, the export's date) and when its pipeline
last ran (`__data_version__`). SETI's `VERSION` records the same two dates
for the copy it holds, and `make check` says if that copy is behind.

**Every Pandit refresh: these three steps, in this order.**

1. **Pāṇḍitya:** on a new branch, bring in the new Pandit export and clean
   it (`data/manual_cleaning.md`, "Updating the Pandit data", steps 1–5).
   Stop before `make transform`. Don't merge yet.
2. **SETI:** `make pandit-copy`, then `make check`. Fix every
   ID it reports (most likely deleted or merged in Pandit; look it up with
   `python3 scripts/lookup.py id <id>`), rerun `make check` until it
   passes, and merge.
3. **Pāṇḍitya, same branch:** copy the SETI master over
   (`data/manual_cleaning.md`, "Updating the SETI data"), then
   `make transform` and `make analyze`, and merge.

Step 2 is where Pandit's deletions and merges are caught and fixed. If
`make transform` fails in step 3, step 2 was skipped or incomplete: go back
to it.

**Anything else** (SETI matcher work or new rows, Pāṇḍitya code) touches
one side only: merge it there, and the other side picks it up at its next
update.

# Feedback, License

Get in touch! Let me know if this is useful, whether you'd like changes, etc.
You can raise an Issue on GitHub, or send me a message by email, etc.
And do please share and share alike: licensed under a [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en).