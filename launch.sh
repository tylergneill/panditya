#!/bin/bash
export FLASK_APP=flask_app.py
export PORT=5042
python -m flask --debug run --port=$PORT