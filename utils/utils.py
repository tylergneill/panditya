from collections import defaultdict
from datetime import datetime
from functools import wraps
import json

SUPPRESS_TIME_DECORATOR = True  # Set this to True to suppress the decorator, False to enable it


def load_config_dict_from_json_file():
    settings_file_path = 'config.json'
    config_data = open(settings_file_path, 'r').read()
    config = json.loads(config_data)
    return config


def time_execution(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if SUPPRESS_TIME_DECORATOR:
            return func(*args, **kwargs)
        print(f"{func.__name__}", end=" ", flush=True)
        start = datetime.now()
        result = func(*args, **kwargs)
        end = datetime.now()
        duration = end - start
        duration_rounded = round(duration.total_seconds() * 1000) / 1000
        print(f"executed in {duration_rounded} seconds")
        return result
    return wrapper


def get_app_version():
    app_version_filepath = './VERSION'
    with open(app_version_filepath, 'r', encoding='utf8') as file:
        # Assuming the __app_version__ line is the first line
        return file.readline().strip().split('=')[1].strip().replace("'", "").replace('"', '')


def get_pandit_data_version():
    data_version_filepath = './VERSION'
    with open(data_version_filepath, 'r', encoding='utf8') as file:
        # Assuming the __pandit_data_version__ line is the second line
        return file.readlines()[1].strip().split('=')[1].strip().replace("'", "").replace('"', '')


def get_seti_data_version():
    data_version_filepath = './VERSION'
    with open(data_version_filepath, 'r', encoding='utf8') as file:
        # Assuming the __seti_data_version__ line is the third line
        return file.readlines()[2].strip().split('=')[1].strip().replace("'", "").replace('"', '')


def summarize_etext_links(etext_links, additional_collection_count_data):
    collection_total_link_counts = additional_collection_count_data['collection_total_link_counts']
    collection_missing_work_id_counts = additional_collection_count_data['collection_missing_work_id_counts']
    works_per_collection = defaultdict(set)

    for work_id, sources in etext_links.items():
        for collection in sources:
            if work_id != '...':
                works_per_collection[collection].add(work_id)

    combined_summary = {
        collection: {
            "etexts": collection_total_link_counts[collection],
            "etexts_missing_works": collection_missing_work_id_counts[collection],
            "etext_coverage": int(
                (
                    collection_total_link_counts[collection] - collection_missing_work_id_counts[collection]
                ) / collection_total_link_counts[collection] * 1000
            ) / 10,
            "works": len(works_per_collection[collection]),
        }
        for collection in works_per_collection
    }

    sorted_summary = dict(
        sorted(combined_summary.items(), key=lambda item: item[1]["works"], reverse=True)
    )

    return sorted_summary


sanskrit_alphabet = [
    'a', 'ā', 'i', 'ī', 'u', 'ū', 'ṛ', 'ṝ', 'ḷ', 'ḹ', 'e', 'ai', 'o', 'au',
    'k', 'kh', 'g', 'gh', 'ṅ',
    'c', 'ch', 'j', 'jh', 'ñ',
    'ṭ', 'ṭh', 'ḍ', 'ḍh', 'ṇ',
    't', 'th', 'd', 'dh', 'n',
    'p', 'ph', 'b', 'bh', 'm',
    'y', 'r', 'l', 'v',
    'ś', 'ṣ', 's',
    'h',
    'ṃ', 'ḥ'
]

# Create a mapping of each symbol to its position
custom_order = {char: idx for idx, char in enumerate(sanskrit_alphabet)}

def custom_sort_key(word):
    word = word.lower()  # Normalize case to lowercase
    return [custom_order.get(word[i:i+2], custom_order.get(word[i], len(sanskrit_alphabet)))
            for i in range(len(word))]