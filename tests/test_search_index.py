"""Unit tests for search_index.py, on a small made-up set of entities."""

from types import SimpleNamespace

import pytest

from search_index import (
    SearchIndex, fold, loosen,
    TIER_ID, TIER_NAME_PREFIX, TIER_WORD_PREFIX, TIER_AKA_PREFIX, TIER_SUBSTRING,
)
from utils.utils import custom_sort_key


def entity(eid, name, type_="author", aka=""):
    return SimpleNamespace(id=eid, name=name, type=type_, aka=aka)


ENTITIES = {e.id: e for e in [
    entity("1", "Kālidāsa"),
    entity("2", "Kumārasaṃbhava", "work"),
    entity("3", "Abhinavagupta"),
    entity("4", "Viveka on Abhinavagupta's Tantrāloka", "work"),
    entity("5", "Tantrāloka", "work"),
    entity("6", "Kṛṣṇa"),
    entity("7", "Śrīdhara"),
    entity("8", "Nārāyaṇa", aka="Nārāyaṇa (Bhaṭṭa) Paṇḍita II"),
    entity("9", "Bhaṭṭoji Dīkṣita"),
    entity("10", "Kṛṣṇamiśra"),
    entity("11", "Siddhāntakaumudī", "work"),
    entity("12", "Bālamanoramā on Siddhāntakaumudī", "work"),
]}


def describe(e):
    return {"id": e.id, "type": e.type, "name": e.name}


@pytest.fixture(scope="module")
def index():
    return SearchIndex.from_entities(ENTITIES, describe, custom_sort_key)


def names(results):
    return [r["name"] for r in results]


# --- fold / loosen ------------------------------------------------------------

@pytest.mark.parametrize("text, expected", [
    ("Kālidāsa", "kalidasa"),
    ("Śṛṅgāraśataka (Bhartṛhari)", "srngarasataka bhartrhari"),
    ("Kumārasaṃbhava", "kumarasambhava"),
    ("Ḍhuṇḍhirāja", "dhundhiraja"),
    ("Kṣemarāja’s  commentary", "ksemaraja s commentary"),
    ("", ""),
    (None, ""),
])
def test_fold_strips_diacritics_case_and_punctuation(text, expected):
    assert fold(text) == expected


@pytest.mark.parametrize("typed, indexed", [
    ("krishna", "Kṛṣṇa"),
    ("shri", "Śrī"),
    ("sri", "Śrī"),
    ("chandra", "Candra"),
    ("bhaashya", "bhāṣya"),
    ("Vishnu", "Viṣṇu"),
    ("waman", "Vāmana"[:5]),  # w → v
])
def test_loosen_lets_common_ascii_spellings_meet(typed, indexed):
    assert loosen(indexed).startswith(loosen(typed))


def test_loosen_is_applied_symmetrically():
    # Whatever the rules do, a name always matches itself.
    for e in ENTITIES.values():
        assert loosen(e.name) == loosen(e.name.upper())


# --- search ---------------------------------------------------------------------

def test_index_covers_every_entity(index):
    assert len(index) == len(ENTITIES)


def test_plain_ascii_finds_diacritic_name(index):
    results = index.search("kalidasa")
    assert names(results)[0] == "Kālidāsa"
    assert results[0]["tier"] == TIER_NAME_PREFIX


def test_loose_spelling_finds_name(index):
    assert names(index.search("krishna"))[:2] == ["Kṛṣṇa", "Kṛṣṇamiśra"]
    assert names(index.search("shridhara")) == ["Śrīdhara"]


def test_exact_id_comes_first(index):
    results = index.search("4")
    assert results[0]["id"] == "4"
    assert results[0]["tier"] == TIER_ID


def test_spaces_in_query_are_ignored_for_name_prefix(index):
    results = index.search("abhinava gupta")
    assert results[0]["name"] == "Abhinavagupta"
    assert results[0]["tier"] == TIER_NAME_PREFIX


def test_name_prefix_ranks_above_word_prefix(index):
    results = index.search("tantraloka")
    assert names(results) == ["Tantrāloka", "Viveka on Abhinavagupta's Tantrāloka"]
    assert [r["tier"] for r in results] == [TIER_NAME_PREFIX, TIER_WORD_PREFIX]


def test_every_token_must_match(index):
    assert names(index.search("viveka tantraloka")) == ["Viveka on Abhinavagupta's Tantrāloka"]
    assert index.search("viveka kumarasambhava") == []


def test_aka_names_are_searched(index):
    results = index.search("pandita")
    assert names(results) == ["Nārāyaṇa"]
    assert results[0]["tier"] == TIER_AKA_PREFIX


def test_substring_match_is_last_resort(index):
    results = index.search("kaumudi")
    # "Siddhāntakaumudī" contains it mid-word; nothing starts with it.
    assert set(names(results)) == {"Siddhāntakaumudī", "Bālamanoramā on Siddhāntakaumudī"}
    assert all(r["tier"] == TIER_SUBSTRING for r in results)
    # Same tier: the shorter (closer) name first.
    assert names(results)[0] == "Siddhāntakaumudī"


def test_type_filter(index):
    assert {r["type"] for r in index.search("a", "works", 50)} == {"work"}
    assert {r["type"] for r in index.search("a", "authors", 50)} == {"author"}
    assert len(index.search("a", "all", 50)) > len(index.search("a", "works", 50))


def test_limit(index):
    assert len(index.search("a", limit=3)) == 3


@pytest.mark.parametrize("query", ["", "   ", "’", None])
def test_empty_query_returns_nothing(index, query):
    assert index.search(query) == []


def test_no_match(index):
    assert index.search("xyzzy") == []


def test_results_are_deterministic(index):
    assert index.search("a", limit=50) == index.search("a", limit=50)


def test_result_carries_describe_fields_plus_tier(index):
    result = index.search("kalidasa")[0]
    assert result == {"id": "1", "type": "author", "name": "Kālidāsa", "tier": TIER_NAME_PREFIX}
