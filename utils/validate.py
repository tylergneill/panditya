"""
Referential-integrity guard for the data pipeline.

Fails loudly (raises DataValidationError) when the transformed data is
inconsistent, rather than letting the app discover a missing ID at request time.

Checks:
  1. Every work ID in the SETI etext-link mapping exists in the entities and is a work.
     (The literal "..." placeholder for "work ID unknown" is exempt.)
  2. Every cross-reference between entities resolves to an entity of the expected type:
       work.author_ids      -> author
       work.base_text_ids   -> work
       work.commentary_ids  -> work
       author.work_ids      -> work

Run standalone against the committed JSON outputs with `make validate`.
"""
import json
import os
from typing import Dict, List

from data_models import Entity
from utils.utils import get_pandit_data_version, get_seti_data_version

current_file_dir = os.path.dirname(os.path.abspath(__file__))
relative_data_dir = "../data"

MISSING_WORK_ID_PLACEHOLDER = "..."

ENTITY_REFERENCE_FIELDS = {
    # (entity type, field name): expected type of the referenced entity
    ("work", "author_ids"): "author",
    ("work", "base_text_ids"): "work",
    ("work", "commentary_ids"): "work",
    ("author", "work_ids"): "work",
}


class DataValidationError(Exception):
    def __init__(self, problems: List[str]):
        self.problems = problems
        header = f"Data validation failed with {len(problems)} problem(s):"
        super().__init__("\n".join([header] + [f"  - {p}" for p in problems]))


def find_entity_reference_problems(entities_by_id: Dict[str, Entity]) -> List[str]:
    problems = []
    for eid, entity in entities_by_id.items():
        for (entity_type, field), expected_type in ENTITY_REFERENCE_FIELDS.items():
            if entity.type != entity_type:
                continue
            for ref_id in getattr(entity, field, None) or []:
                target = entities_by_id.get(ref_id)
                if target is None:
                    problems.append(f"{entity_type} {eid} ({entity.name!r}): {field} references unknown entity {ref_id}")
                elif target.type != expected_type:
                    problems.append(
                        f"{entity_type} {eid} ({entity.name!r}): {field} references {ref_id}, "
                        f"which is a {target.type}, not a {expected_type}"
                    )
    return problems


def find_etext_link_problems(entities_by_id: Dict[str, Entity], work_id_to_link_mapping: Dict) -> List[str]:
    problems = []
    for work_id in work_id_to_link_mapping:
        if work_id == MISSING_WORK_ID_PLACEHOLDER:
            continue
        entity = entities_by_id.get(work_id)
        collections = sorted(work_id_to_link_mapping[work_id].keys())
        if entity is None:
            problems.append(f"SETI work ID {work_id} (collections: {', '.join(collections)}) has no Pandit entity")
        elif entity.type != "work":
            problems.append(
                f"SETI work ID {work_id} (collections: {', '.join(collections)}) "
                f"is a {entity.type} ({entity.name!r}), not a work"
            )
    return problems


def validate_data(entities_by_id: Dict[str, Entity], work_id_to_link_mapping: Dict) -> None:
    """Raise DataValidationError listing every problem found; return silently if the data is consistent."""
    problems = find_entity_reference_problems(entities_by_id) + find_etext_link_problems(entities_by_id, work_id_to_link_mapping)
    if problems:
        raise DataValidationError(problems)


def validate_output_files() -> None:
    """Validate the committed JSON outputs of the transform step for the current data versions."""
    entities_filename = f"{get_pandit_data_version()}-entities.json"
    links_filename = f"{get_seti_data_version()}-etext-link-data.json"
    with open(os.path.join(current_file_dir, relative_data_dir, entities_filename), "r") as f:
        entities_by_id = {eid: Entity.create_from_dict(edict) for eid, edict in json.load(f).items()}
    with open(os.path.join(current_file_dir, relative_data_dir, links_filename), "r") as f:
        work_id_to_link_mapping = json.load(f)["work_id_to_link_mapping"]
    validate_data(entities_by_id, work_id_to_link_mapping)
    print(f"Data validation passed: {len(entities_by_id)} entities, {len(work_id_to_link_mapping)} SETI work IDs")


if __name__ == "__main__":
    validate_output_files()
