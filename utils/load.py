import json
import os

from data_models import Entity
from utils.utils import time_execution, get_pandit_data_version, get_seti_data_version

current_file_dir = os.path.dirname(os.path.abspath(__file__))
relative_data_dir = "../data"

PANDIT_DATA_VERSION = get_pandit_data_version()
SETI_DATA_VERSION = get_seti_data_version()


@time_execution
def load_entities():
    input_filename = f"{PANDIT_DATA_VERSION}-entities.json"
    input_json_path = os.path.join(current_file_dir, relative_data_dir, input_filename)
    with open(input_json_path, "r") as jsonfile:
        data = json.load(jsonfile)
    entities_by_id = {eid: Entity.create_from_dict(edict) for eid, edict in data.items()}
    return entities_by_id

@time_execution
def load_link_data():
    input_filename = f"{SETI_DATA_VERSION}-etext-link-data.json"
    input_json_path = os.path.join(current_file_dir, relative_data_dir, input_filename)
    with open(input_json_path, "r") as jsonfile:
        data = json.load(jsonfile)

    (count_data := data.copy()).pop('work_id_to_link_mapping')

    return data["work_id_to_link_mapping"], count_data