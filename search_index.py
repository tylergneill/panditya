"""
Entity search behind the Pāṇḍitya search box.

The old interface shipped every author and work (~17.7k entities, ~1.5 MB of
JSON) to the browser on each page load and handed them to Select2. This module
replaces that with a small server-side index: the browser sends what the user
has typed so far and gets back the top few matches.

Matching is forgiving about how Sanskrit gets typed on an ordinary keyboard:

1. ``fold`` strips diacritics and case, so "kalidasa" finds "Kālidāsa" and
   "srngara" finds "Śṛṅgāra".
2. ``loosen`` then applies a few symmetric spelling rules (``sh``→``s``,
   ``ch``→``c``, ``ri``→``r``, doubled vowels→single, ``w``→``v``). Because
   the same rules are applied to both the query and the indexed names, "shri",
   "sri" and "śrī" all meet at the same key, as do "krishna" and "kṛṣṇa".
   The rules are lossy on purpose; they only decide what *matches*, never what
   is displayed.

Results are ranked in tiers (see ``SearchIndex.search``), then by name length
(shorter, i.e. closer, matches first) and finally in Sanskrit alphabetical order.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Callable, Dict, Iterable, List, Optional

# Applied in order by ``loosen``. Doubled vowels go first, so that e.g. Velthuis
# "rii" becomes "ri" and is then caught by the "ri" rule.
LOOSE_RULES = [
    (re.compile(r"aa"), "a"),
    (re.compile(r"ii"), "i"),
    (re.compile(r"uu"), "u"),
    (re.compile(r"ee"), "e"),
    (re.compile(r"oo"), "o"),
    (re.compile(r"sh"), "s"),
    (re.compile(r"ch"), "c"),
    (re.compile(r"ri"), "r"),
    (re.compile(r"w"), "v"),
]

_NON_ALNUM = re.compile(r"[^a-z0-9]+")

# Ranking tiers, best first. Exposed so tests can refer to them by name.
TIER_ID = 0            # the query is exactly the entity's Pandit ID
TIER_NAME_PREFIX = 1   # the whole name starts with the query (spaces ignored)
TIER_WORD_PREFIX = 2   # every query token starts some word of the name
TIER_AKA_PREFIX = 3    # same as above, but matched in the "aka" names
TIER_SUBSTRING = 4     # every query token occurs somewhere in name or aka


def fold(text: Optional[str]) -> str:
    """
    Lowercase ``text``, strip its diacritics and reduce it to ASCII words.

    Decomposing to NFD splits e.g. "ṛ" into "r" + COMBINING DOT BELOW, so
    dropping all combining marks (Unicode category ``Mn``) leaves plain letters.
    Any run of other characters (punctuation, brackets, avagraha) becomes a
    single space.

    >>> fold("Śṛṅgāraśataka (Bhartṛhari)")
    'srngarasataka bhartrhari'
    """
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFD", text.lower())
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return _NON_ALNUM.sub(" ", stripped).strip()


def loosen(text: Optional[str]) -> str:
    """
    ``fold`` ``text``, then apply ``LOOSE_RULES`` so common ASCII spellings meet.

    >>> loosen("Kṛṣṇa") == loosen("krishna")
    True
    """
    key = fold(text)
    for pattern, replacement in LOOSE_RULES:
        key = pattern.sub(replacement, key)
    return key


@dataclass
class _Entry:
    """One indexed entity: its search keys plus the result it will produce."""
    id: str
    type: str
    name_key: str
    aka_key: str
    name_compact: str
    words: List[str]
    aka_words: List[str]
    result: Dict
    sort_key: list = field(default_factory=list)


class SearchIndex:
    """
    An in-memory search index over Pāṇḍitya entities.

    Build it once at startup with ``SearchIndex.from_entities``; each call to
    ``search`` is then a linear scan over precomputed keys, which takes a few
    milliseconds for the whole Pandit export.
    """

    def __init__(self, entries: Iterable[_Entry]):
        self._entries: List[_Entry] = list(entries)

    def __len__(self) -> int:
        return len(self._entries)

    @classmethod
    def from_entities(
        cls,
        entities_by_id: Dict,
        describe: Callable[[object], Dict],
        sort_key: Callable[[str], list],
    ) -> "SearchIndex":
        """
        Index every entity in ``entities_by_id``.

        Args:
            entities_by_id: Pandit ID → ``Work``/``Author`` (see ``data_models``).
            describe: entity → the dict returned to the browser for that entity.
            sort_key: name → key giving Sanskrit alphabetical order
                (``utils.utils.custom_sort_key``).
        """
        entries = []
        for entity in entities_by_id.values():
            name_key = loosen(entity.name)
            aka_key = loosen(entity.aka)
            entries.append(_Entry(
                id=entity.id,
                type=entity.type,
                name_key=name_key,
                aka_key=aka_key,
                name_compact=name_key.replace(" ", ""),
                words=name_key.split(),
                aka_words=aka_key.split(),
                result=describe(entity),
                sort_key=sort_key(entity.name or ""),
            ))
        return cls(entries)

    @staticmethod
    def _tier(entry: _Entry, query_key: str, tokens: List[str], raw_query: str) -> Optional[int]:
        """Return the best ranking tier ``entry`` reaches for this query, or None."""
        if raw_query == entry.id:
            return TIER_ID
        # Spaces ignored, so "abhinava gupta" finds "Abhinavagupta".
        if entry.name_compact.startswith(query_key.replace(" ", "")):
            return TIER_NAME_PREFIX

        def all_tokens_start_words(words: List[str]) -> bool:
            return all(any(word.startswith(token) for word in words) for token in tokens)

        if all_tokens_start_words(entry.words):
            return TIER_WORD_PREFIX
        if entry.aka_words and (entry.aka_key.startswith(query_key) or all_tokens_start_words(entry.aka_words)):
            return TIER_AKA_PREFIX
        haystack = entry.name_key + " " + entry.aka_key
        if all(token in haystack for token in tokens):
            return TIER_SUBSTRING
        return None

    def search(self, query: str, entity_type: str = "all", limit: int = 20) -> List[Dict]:
        """
        Return up to ``limit`` result dicts for ``query``, best first.

        Args:
            query: what the user typed. A bare number is also tried as a Pandit ID.
            entity_type: "all", "authors" or "works".
            limit: maximum number of results.

        Each result is the ``describe`` dict for the entity, plus ``"tier"``
        (see the ``TIER_*`` constants) so the client or a test can tell an exact
        hit from a loose one.
        """
        raw_query = (query or "").strip()
        query_key = loosen(raw_query)
        if not query_key:
            return []
        tokens = query_key.split()
        wanted_type = {"authors": "author", "works": "work"}.get(entity_type)

        hits = []
        for entry in self._entries:
            if wanted_type and entry.type != wanted_type:
                continue
            tier = self._tier(entry, query_key, tokens, raw_query)
            if tier is not None:
                hits.append((tier, len(entry.name_key), entry.sort_key, entry))

        hits.sort(key=lambda hit: hit[:3])
        return [{**entry.result, "tier": tier} for tier, _, _, entry in hits[:limit]]
