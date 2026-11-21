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

Each repo copies the other's output and records what it copied in its
`VERSION`: Pāṇḍitya the SETI master (`make seti-import`), SETI
Pāṇḍitya's cleaned Pandit extract (`make pandit-copy`).

**A SETI change, to see in Pāṇḍitya.** Commit it in SETI and run
`make master-date` there. Then, in Pāṇḍitya, `make seti-refresh` and
restart the server. `seti-refresh` refuses a master with uncommitted
changes or an out-of-date date; `FORCE=1` copies it anyway, for work in
progress.

**A new Pandit export.**

1. **Pāṇḍitya,** on a new branch: bring in the export
   (`data/manual_cleaning.md`, "Updating the Pandit data", steps 1–3),
   then `make pipeline`. Its transform checks SETI's work IDs against the
   new data: if any are missing, it lists them and writes nothing. Don't
   merge yet.
2. **SETI:** `make pandit-copy`, then `make check`, which lists every ID
   in the master that the new data lacks (most likely deleted or merged
   in Pandit; look one up with `python3 scripts/lookup.py id <id>`). Fix
   them, commit, run `make master-date`, commit `VERSION`, and merge.
3. **Pāṇḍitya,** same branch: `make seti-refresh`, then `make analyze`.
   Merge.

# Feedback, License

Get in touch! Let me know if this is useful, whether you'd like changes, etc.
You can raise an Issue on GitHub, or send me a message by email, etc.
And do please share and share alike: licensed under a [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en).