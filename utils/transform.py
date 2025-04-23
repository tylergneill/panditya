from collections import defaultdict
import csv
import json
import os
from collections import Counter
import re
from typing import Optional

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
    Transform CSV data (containing both Works and Persons) into data_models Entity objects,
    stored in JSON.

    Expected CSV columns include:
      - "Content type"                ("Work" or "Person", drop after use)
      - "ID"
      - "Name"
      - "Aka"
      - "Social identifiers"          (Persons only)
      - "Authors (IDs)"               (Works only)
      - "Authors (names)"             (Works only)
      - "Discipline"                  (Works only)
      - "Base texts (work ID)"        (Works only)
      - "Base texts (work)"           (Works only)
      - "Highest Year"
      - "Lowest Year"

    For Persons (Authors), we later compute a "Disciplines" attribute that aggregates,
    by relative frequency (including counts), the disciplines of their associated works.
    Only Persons with at least one associated work are kept.
    """

    input_filename = f"{PANDIT_DATA_VERSION}-works-cleaned.csv"
    input_csv_path = os.path.join(current_file_dir, relative_data_dir, input_filename)

    entities_by_id = {}

    def split_field(field):
        return [item.strip() for item in field.split(",") if item.strip()]

    with open(input_csv_path, 'r') as csvfile:
        reader = csv.DictReader(csvfile)

        for row in reader:
            # Get common fields
            content_type = row.get("Content type", "").strip().lower()
            entity_id = row["ID"].strip()
            name = row["Name"].strip()
            aka = row.get("Aka", "").strip()
            highest_year_str = row.get("Highest Year", None).strip()
            lowest_year_str = row.get("Lowest Year", None).strip()
            highest_year, lowest_year = (int(highest_year_str), int(lowest_year_str)) if highest_year_str else (None, None)

            if content_type == "work":
                discipline = row.get("Discipline", "").strip()

                # Update or create
                if entity_id in entities_by_id:
                    W = entities_by_id[entity_id]
                else:
                    W = Work(entity_id)
                    entities_by_id[entity_id] = W

                W.name = name
                W.aka = aka
                W.discipline = discipline
                W.highest_year: Optional[int] = highest_year
                W.lowest_year: Optional[int] = lowest_year

                # Process author information from work row.
                author_ids = split_field(row.get("Authors (IDs)", ""))
                author_names = split_field(row.get("Authors (names)", ""))

                for aid, aname in zip(author_ids, author_names):

                    # Update or create
                    if aid in entities_by_id:
                        A = entities_by_id[aid]
                    else:
                        A = Author(aid)
                        entities_by_id[aid] = A

                    # Associate work with author and vice versa
                    A.name = aname
                    if W.id not in A.work_ids:
                        A.work_ids.append(W.id)
                    if A.id not in W.author_ids:
                        W.author_ids.append(A.id)

                # Process base-text and commentary relations
                base_text_ids = split_field(row.get("Base texts (IDs)", ""))
                base_text_names = split_field(row.get("Base texts (names)", ""))
                for base_text_id, base_text_name in zip(base_text_ids, base_text_names):

                    # Update or create
                    if base_text_id in entities_by_id:
                        BT = entities_by_id[base_text_id]
                    else:
                        BT = Work(base_text_id)
                        entities_by_id[base_text_id] = BT

                    # Associate base text with commentary and vice versa
                    BT.name = base_text_name
                    if W.id not in BT.commentary_ids:
                        BT.commentary_ids.append(W.id)
                    if BT.id not in W.base_text_ids:
                        W.base_text_ids.append(BT.id)

            elif content_type == "person":
                social_identifiers = row.get("Social identifiers", None).strip()

                # Update or create
                if entity_id in entities_by_id:
                    A = entities_by_id[entity_id]
                else:
                    A = Author(entity_id)
                    entities_by_id[entity_id] = A

                A.name = name
                A.aka = aka
                A.social_identifiers = social_identifiers
                A.highest_year: Optional[int] = highest_year
                A.lowest_year: Optional[int] = lowest_year
            # If content type is unrecognized, skip the row.

    # Combined post-processing pass
    for eid, entity in list(entities_by_id.items()):
        if entity.type == "author":
            # Remove authors with no associated works.
            if not entity.work_ids:
                del entities_by_id[eid]
            else:
                # Aggregate disciplines from each associated work.
                discipline_counter = Counter()
                for wid in entity.work_ids:
                    work = entities_by_id.get(wid)
                    if work and getattr(work, "discipline", ""):
                        discipline_counter[work.discipline] += 1
                if discipline_counter:
                    # Order by descending frequency and then alphabetically.
                    sorted_disciplines = sorted(discipline_counter.items(), key=lambda x: (-x[1], x[0]))
                    # Build string like "Nyāya (3), Yoga (1)"
                    entity.disciplines = ", ".join([f"{disc} ({count})" for disc, count in sorted_disciplines])
        elif entity.type == "work":
            # If the work's own year information is missing, try to supplement it from its authors.
            if entity.highest_year is None:
                for aid in entity.author_ids:
                    author = entities_by_id.get(aid)
                    if author and getattr(author, "highest_year", None) is not None:
                        entity.author_highest_year = author.highest_year
                        entity.author_lowest_year = author.lowest_year
                        break  # Use the first available author date

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

    input_filename = f"{seti_data_version}-seti-master.csv"
    input_csv_path = os.path.join(current_file_dir, relative_data_dir, input_filename)
    df = pd.read_csv(input_csv_path)

    link_types = {
        'main': 'Link 1 (main)',
        'underlying': 'Link 2 (underlying)',
        'extract': 'Link 3 (extract)',
    }

    work_id_mapping = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))

    collection_subtype_labels = {
        'DCS': ('web HTML', 'GitHub (1) CoNLL-U', 'GitHub (2) TXT'),
        'GRETIL': ('web HTML'),
        'Muktabodha KSTS': ('web HTML'),
        'SARIT': ('web HTML', 'GitHub XML'),
        'Sanskrit Library and TITUS': ('Skt Lib web HTML', 'TITUS web HTML'),
        'Vātāyana and Pramāṇa NLP': ('Vātāyana web HTML', 'Pramāṇa NLP GitHub'),
    }
    collection_keys = list(collection_subtype_labels.keys())

    collection_total_link_counts = defaultdict(int, dict.fromkeys(collection_keys, 0))
    collection_missing_work_id_counts = defaultdict(int, dict.fromkeys(collection_keys, 0))

    for row in df.to_dict(orient="records"):
        collection_name = row['Collection']

        if pd.isna(row['Work ID']) or row['Work ID'] == "":
            continue

        if any(pd.notna(row[k]) for k in ('Link 1 (main)',
                                          'Link 2 (underlying)',
                                          'Link 3 (extract)')):
            collection_total_link_counts[collection_name] += 1
            if row['Work ID'] == "...":
                collection_missing_work_id_counts[collection_name] += 1

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

    final_result = {
        "work_id_to_link_mapping": convert_to_serializable(work_id_mapping),
        "collection_total_link_counts": collection_total_link_counts,
        "collection_missing_work_id_counts": collection_missing_work_id_counts,
    }

    # Save to JSON for human-readability
    output_filename = f"{ETEXT_DATA_VERSION}-etext-link-data.json"
    output_json_path = os.path.join(current_file_dir, relative_data_dir, output_filename)
    with open(output_json_path, 'w') as jsonfile:
        json.dump(convert_to_serializable(final_result), jsonfile, indent=4, ensure_ascii=False)


if __name__ == "__main__":
    create_entities()
    create_etext_links()