import json
import os

from data_models import Entity
from utils.utils import time_execution, get_pandit_content_version, get_seti_content_version

current_file_dir = os.path.dirname(os.path.abspath(__file__))
relative_data_dir = "../data"

PANDIT_CONTENT_VERSION = get_pandit_content_version()
SETI_CONTENT_VERSION = get_seti_content_version()


@time_execution
def load_entities():
    input_filename = f"{PANDIT_CONTENT_VERSION}-entities.json"
    input_json_path = os.path.join(current_file_dir, relative_data_dir, input_filename)
    with open(input_json_path, "r") as jsonfile:
        data = json.load(jsonfile)
    entities_by_id = {eid: Entity.create_from_dict(edict) for eid, edict in data.items()}
    return entities_by_id

@time_execution
def load_link_data():
    input_filename = f"{SETI_CONTENT_VERSION}-etext-link-data.json"
    input_json_path = os.path.join(current_file_dir, relative_data_dir, input_filename)
    with open(input_json_path, "r") as jsonfile:
        data = json.load(jsonfile)

    (count_data := data.copy()).pop('work_id_to_link_mapping')

    return data["work_id_to_link_mapping"], count_data

def load_data_summary():
    """Figures for the Data Notes page, written by utils.analyze."""
    input_json_path = os.path.join(current_file_dir, relative_data_dir, "analysis_results", "summary.json")
    with open(input_json_path, "r") as jsonfile:
        summary = json.load(jsonfile)
    if summary["pandit_content_version"] != PANDIT_CONTENT_VERSION:
        print(f"Warning: analysis summary is for {summary['pandit_content_version']}, "
              f"but the data is {PANDIT_CONTENT_VERSION}; run `make analyze`")
    return summary