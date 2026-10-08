PYTHONPATH=$(shell pwd) python -m utils.transform

extract:
	python -m utils.extract

transform:
	python -m utils.transform

validate:
	python -m utils.validate

analyze:
	python -m utils.analyze

construct_full_graph:
	python -m utils.construct_full_graph

run:
	python flask_app.py