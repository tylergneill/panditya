# To update the Pandit data: see data/manual_cleaning.md.
# extract: export -> raw extract. Clean by hand. transform: cleaned extract -> entities.json.
# analyze: entities.json -> analysis_results/, including the Data Notes figures.

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