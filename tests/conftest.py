"""
Shared pytest setup.

The app reads config.json, VERSION and data/ relative to the working
directory, so every test runs from the repository root, whatever directory
pytest was started in.
"""

import os
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(REPO_ROOT)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


@pytest.fixture(scope="session")
def flask_module():
    """The flask_app module, loaded once (it loads the real data at import)."""
    import flask_app
    return flask_app


@pytest.fixture(scope="session")
def client(flask_module):
    flask_module.app.config["TESTING"] = True
    return flask_module.app.test_client()
