"""
Unit tests for graph construction (grapher.py), on a small made-up network:

    author A1 ──wrote──▶ W1 (base text) ──commentary──▶ W2 ──commentary──▶ W3
    author A2 ──wrote──▶ W2
    author A3 ──wrote──▶ W3, W4
    W5: a work with no connections at all
"""

import pytest

from data_models import Author, Work
from grapher import construct_subgraph, construct_graph, count_hidden_neighbors, neighbor_ids


def make_entities():
    def work(eid, authors=(), base=(), commentaries=()):
        w = Work(eid)
        w.name = f"Work {eid}"
        w.author_ids, w.base_text_ids, w.commentary_ids = list(authors), list(base), list(commentaries)
        return w

    def author(eid, works=()):
        a = Author(eid)
        a.name = f"Author {eid}"
        a.work_ids = list(works)
        return a

    entities = [
        author("A1", ["W1"]),
        author("A2", ["W2"]),
        author("A3", ["W3", "W4"]),
        work("W1", authors=["A1"], commentaries=["W2"]),
        work("W2", authors=["A2"], base=["W1"], commentaries=["W3"]),
        work("W3", authors=["A3"], base=["W2"]),
        work("W4", authors=["A3"]),
        work("W5"),
    ]
    return {e.id: e for e in entities}


@pytest.fixture
def entities():
    return make_entities()


def test_zero_hops_is_just_the_centers(entities):
    g = construct_subgraph(["W2"], 0, [], entities)
    assert set(g.nodes) == {"W2"}


def test_one_hop(entities):
    g = construct_subgraph(["W2"], 1, [], entities)
    assert set(g.nodes) == {"W2", "A2", "W1", "W3"}
    assert set(g.edges) == {("A2", "W2"), ("W1", "W2"), ("W2", "W3")}


def test_two_hops(entities):
    g = construct_subgraph(["W2"], 2, [], entities)
    assert set(g.nodes) == {"W2", "A2", "W1", "W3", "A1", "A3"}


def test_edges_point_author_to_work_and_base_to_commentary(entities):
    g = construct_subgraph(["W3"], 2, [], entities)
    assert ("A3", "W3") in g.edges
    assert ("W2", "W3") in g.edges
    assert ("W3", "W2") not in g.edges


def test_excluded_node_is_shown_but_not_expanded(entities):
    g = construct_subgraph(["W2"], 2, ["W1"], entities)
    assert "W1" in g.nodes
    assert "A1" not in g.nodes  # only W1 led to A1


def test_isolated_center_is_kept(entities):
    g = construct_subgraph(["W5"], 2, [], entities)
    assert set(g.nodes) == {"W5"}


def test_several_centers(entities):
    g = construct_subgraph(["A1", "W4"], 1, [], entities)
    assert set(g.nodes) == {"A1", "W1", "W4", "A3"}


def test_hop_count_is_exact_on_a_chain(entities):
    # A1 → W1 → W2 → W3 → A3 → W4: each extra hop adds exactly the next link.
    expected = [
        {"A1"},
        {"A1", "W1"},
        {"A1", "W1", "W2"},
        {"A1", "W1", "W2", "A2", "W3"},
    ]
    for hops, nodes in enumerate(expected):
        assert set(construct_subgraph(["A1"], hops, [], entities).nodes) == nodes, hops


def test_expand_adds_one_hop_around_the_node(entities):
    base = construct_graph(["W2"], 1, [], [], entities)
    grown = construct_graph(["W2"], 1, [], ["W3"], entities)
    assert set(grown.nodes) - set(base.nodes) == {"A3"}
    assert ("A3", "W3") in grown.edges


def test_expand_overrides_exclude_for_that_node_only(entities):
    g = construct_graph(["W2"], 1, ["W1", "W3"], ["W1"], entities)
    assert "A1" in g.nodes      # W1 was expanded despite being excluded
    assert "A3" not in g.nodes  # W3 is still excluded (and wasn't expanded)


def test_expand_respects_other_exclusions(entities):
    # Expanding A3 reaches W3 and W4; W3 is excluded, so nothing beyond it.
    g = construct_graph(["W4"], 0, ["W3"], ["A3"], entities)
    assert set(g.nodes) == {"W4", "A3", "W3"}


def test_no_expand_is_the_plain_subgraph(entities):
    a = construct_graph(["W2"], 2, ["W1"], [], entities)
    b = construct_subgraph(["W2"], 2, ["W1"], entities)
    assert set(a.nodes) == set(b.nodes) and set(a.edges) == set(b.edges)


def test_neighbor_ids(entities):
    assert set(neighbor_ids(entities["W2"])) == {"A2", "W1", "W3"}
    assert neighbor_ids(entities["A3"]) == ["W3", "W4"]
    assert neighbor_ids(entities["W5"]) == []


def test_count_hidden_neighbors(entities):
    g = construct_subgraph(["W2"], 1, [], entities)
    assert count_hidden_neighbors(g, "W2", entities) == 0
    assert count_hidden_neighbors(g, "W1", entities) == 1  # A1
    assert count_hidden_neighbors(g, "W3", entities) == 1  # A3
    assert count_hidden_neighbors(g, "A2", entities) == 0


def test_count_hidden_neighbors_on_zero_hops(entities):
    g = construct_subgraph(["A3"], 0, [], entities)
    assert count_hidden_neighbors(g, "A3", entities) == 2


# --- remove_list: taking nodes off the graph --------------------------------------

def test_remove_takes_a_node_and_its_branch_off(entities):
    full = construct_graph(["W1"], 3, [], entities_by_id=entities)
    assert {"W2", "A2", "W3"} <= set(full.nodes)
    g = construct_graph(["W1"], 3, [], entities_by_id=entities, remove_list=["W2"])
    # Everything past W2 was only reachable through it.
    assert set(g.nodes) == {"W1", "A1"}


def test_remove_keeps_what_is_reachable_another_way(entities):
    g = construct_graph(["W2"], 2, [], entities_by_id=entities, remove_list=["W1"])
    assert set(g.nodes) == {"W2", "A2", "W3", "A3"}  # A1 was only there through W1
    assert not any("W1" in edge for edge in g.edges)


def test_remove_ignores_searched_for_nodes(entities):
    g = construct_graph(["W2"], 1, [], entities_by_id=entities, remove_list=["W2"])
    assert "W2" in g.nodes


def test_expanding_a_neighbour_does_not_bring_a_removed_node_back(entities):
    g = construct_graph(["W1"], 1, [], ["W2"], entities_by_id=entities, remove_list=["W3"])
    assert "W3" not in g.nodes
    assert "A2" in g.nodes  # the rest of the expansion still happens


def test_expanding_a_removed_node_does_nothing(entities):
    g = construct_graph(["W1"], 1, [], ["W2"], entities_by_id=entities, remove_list=["W2"])
    assert set(g.nodes) == {"W1", "A1"}


def test_remove_does_not_change_the_callers_lists(entities):
    exclude, remove = ["A1"], ["W2", "W2"]
    construct_graph(["W1"], 2, exclude, entities_by_id=entities, remove_list=remove)
    assert exclude == ["A1"] and remove == ["W2", "W2"]


def test_hidden_neighbors_skip_removed_nodes(entities):
    g = construct_graph(["W2"], 0, [], entities_by_id=entities)
    assert count_hidden_neighbors(g, "W2", entities) == 3  # A2, W1, W3
    assert count_hidden_neighbors(g, "W2", entities, removed=["W1"]) == 2
