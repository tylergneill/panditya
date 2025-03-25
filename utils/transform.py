from collections import defaultdict
import csv
import json
import os
import re

import pandas as pd

from data_models import Work, Author
from utils.utils import time_execution, find_pandit_data_version, find_etext_data_version

current_file_dir = os.path.dirname(os.path.abspath(__file__))
relative_data_dir = "../data"

PANDIT_DATA_VERSION = find_pandit_data_version()
ETEXT_DATA_VERSION = find_etext_data_version()


@time_execution
def create_entities():
    """
    Transform reduced CSV data to data.models.Entity objects stored in JSON.
    """

    input_filename = f"{PANDIT_DATA_VERSION}-works-cleaned.csv"
    input_csv_path = os.path.join(current_file_dir, relative_data_dir, input_filename)

    entities_by_id = {}

    with open(input_csv_path, 'r') as csvfile:
        reader = csv.DictReader(csvfile)

        for row in reader:
            work_id = row["ID"]
            work_name = row["Title"]
            author_ids = [id.strip() for id in (row["Authors (IDs)"] or "").split(",") if id.strip()]
            author_names = [name.strip() for name in (row["Authors (names)"] or "").split(",") if name.strip()]
            base_text_ids = [id.strip() for id in (row["Base texts (IDs)"] or "").split(",") if id.strip()]
            base_text_names = [name.strip() for name in (row["Base texts (names)"] or "").split(",") if name.strip()]

            # Handle Work entity
            if work_id in entities_by_id:
                W = entities_by_id[work_id]
            else:
                W = Work(work_id)
                entities_by_id[work_id] = W
            W.name = work_name

            # Handle Author entities
            for author_id, author_name in zip(author_ids, author_names):
                if author_id in entities_by_id:
                    A = entities_by_id[author_id]
                else:
                    A = Author(author_id)
                    entities_by_id[author_id] = A
                A.name = author_name
                if W.id not in A.work_ids:
                    A.work_ids.append(W.id)
                if A.id not in W.author_ids:
                    W.author_ids.append(A.id)

            # Handle Base Text entities
            for base_text_id, base_text_name in zip(base_text_ids, base_text_names):
                if base_text_id in entities_by_id:
                    BT = entities_by_id[base_text_id]
                else:
                    BT = Work(base_text_id)
                    entities_by_id[base_text_id] = BT
                BT.name = base_text_name
                if W.id not in BT.commentary_ids:
                    BT.commentary_ids.append(W.id)
                if BT.id not in W.base_text_ids:
                    W.base_text_ids.append(BT.id)

    # Save to JSON for human-readability
    output_filename = f"{PANDIT_DATA_VERSION}-entities.json"
    output_json_path = os.path.join(current_file_dir, relative_data_dir, output_filename)
    with open(output_json_path, 'w') as jsonfile:
        json.dump({eid: e.to_dict() for eid, e in entities_by_id.items()}, jsonfile, indent=4, ensure_ascii=False)

    return entities_by_id


@time_execution
def create_etext_links():
    """
    Transform SETI CSV data to work-id -> link mapping stored in JSON.
    """

    input_filename = f"{ETEXT_DATA_VERSION}-seti.csv"
    input_csv_path = os.path.join(current_file_dir, relative_data_dir, input_filename)
    df = pd.read_csv(input_csv_path)

    link_types = {
        'main': 'Link 1 (main)',
        'underlying': 'Link 2 (underlying)',
        'extract': 'Link 3 (extract)',
    }

    work_id_mapping = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))

    collection_subtype_labels = {
        # 'GRETIL': ('web'),
        'SARIT': ('web HTML', 'GitHub XML'),
        'DCS': ('web HTML', 'GitHub (1) CoNLL-U', 'GitHub (2) TXT'),
        # 'MB KSTS': ('web'),
        'Vātāyana and Pramāṇa NLP': ('web HTML', 'GitHub'),
        'Sanskrit Library and TITUS': ('Skt Lib web HTML', 'TITUS web HTML'),
    }

    for row in df.to_dict(orient="records"):
        collection_name = row['Collection']

        if pd.isna(row['Work ID']) or row['Work ID'] == "":
            continue

        work_ids = [wid.strip() for wid in re.split(r'[,\r\n]+', str(row['Work ID']))]

        mapped_labels = collection_subtype_labels.get(collection_name, list(link_types.keys()))

        for link_type, col_name in link_types.items():
            if col_name in row and pd.notna(row[col_name]) and row[col_name].strip():
                link = row[col_name].strip()
                subtype = mapped_labels[
                    list(link_types.keys()).index(link_type)] if collection_name in collection_subtype_labels else link_type

                for work_id in work_ids:
                    work_id_mapping[work_id][collection_name][subtype].add(link)

    for work_id, collections in work_id_mapping.items():
        for collection_name, subtypes in list(collections.items()):  # Convert to list to allow modification
            # Convert all sets to sorted lists
            for subtype, links in subtypes.items():
                work_id_mapping[work_id][collection_name][subtype] = sorted(links)

            # If only one subtype exists, move directly under collection_name
            if len(subtypes) == 1:
                work_id_mapping[work_id][collection_name] = next(iter(subtypes.values()))  # Extract the only list

    # Convert defaultdict structure to a regular dictionary for JSON serialization
    def convert_to_serializable(d):
        result = {}
        for work_id, collections in d.items():
            result[work_id] = {}
            for collection_name, links in collections.items():
                if isinstance(links, list):  # Direct mapping (single link type, no subtypes)
                    result[work_id][collection_name] = links
                elif isinstance(links, dict):  # Collection has subtypes
                    result[work_id][collection_name] = {k: v for k, v in links.items()}
                else:
                    result[work_id][collection_name] = links  # Fallback
        return result

    # Save to JSON for human-readability
    output_filename = f"{ETEXT_DATA_VERSION}-etext-link-data.json"
    output_json_path = os.path.join(current_file_dir, relative_data_dir, output_filename)
    with open(output_json_path, 'w') as jsonfile:
        json.dump(convert_to_serializable(work_id_mapping), jsonfile, indent=4, ensure_ascii=False)


if __name__ == "__main__":
    create_entities()
    create_etext_links()