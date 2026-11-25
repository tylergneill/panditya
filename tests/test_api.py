"""
Tests for the Flask app against the real data in data/.

IDs used (from the 2026-11 Pandit export):
    40377  Kālidāsa (author)          85303  Bhāsarvajña (author)
    89000  Nyāyasāra (work)           85352  Abhinavagupta (author)
If a future export renumbers these, update them here.
"""

import json
import re

import pytest

KALIDASA = "40377"
BHASARVAJNA = "85303"
NYAYASARA = "89000"
ABHINAVAGUPTA = "85352"


INFO_PAGES = ["/about", "/seti", "/tutorials", "/notes/author", "/notes/data",
              "/notes/license", "/notes/technical", "/notes/updates"]


def post_graph(client, **body):
    body.setdefault("hops", 1)
    return client.post("/api/graph/subgraph", json=body)


def node_ids(response):
    return {n["id"] for n in response.get_json()["graph"]["nodes"]}


# --- /api/entities/search ---------------------------------------------------

class TestSearch:
    def test_ascii_query_finds_diacritic_name(self, client):
        r = client.get("/api/entities/search?q=kalidasa")
        assert r.status_code == 200
        results = r.get_json()
        assert results[0]["name"] == "Kālidāsa"
        assert KALIDASA in [x["id"] for x in results[:3]]

    def test_result_shape(self, client):
        result = client.get(f"/api/entities/search?q={NYAYASARA}").get_json()[0]
        assert result["id"] == NYAYASARA
        assert result["type"] == "work"
        assert result["name"] == "Nyāyasāra"
        assert set(result) >= {"id", "type", "name", "aka", "dates", "has_etexts", "tier"}
        assert result["tier"] == 0  # exact ID

    def test_diacritics_in_query_also_work(self, client):
        assert client.get("/api/entities/search?q=Kālidāsa").get_json()[0]["name"] == "Kālidāsa"

    def test_type_filter(self, client):
        works = client.get("/api/entities/search?q=abhinavagupta&type=works&limit=50").get_json()
        assert works and all(x["type"] == "work" for x in works)
        authors = client.get("/api/entities/search?q=abhinavagupta&type=authors").get_json()
        assert authors and all(x["type"] == "author" for x in authors)

    def test_limit(self, client):
        assert len(client.get("/api/entities/search?q=a&limit=7").get_json()) == 7
        assert len(client.get("/api/entities/search?q=a").get_json()) == 20

    @pytest.mark.parametrize("query", ["limit=0", "limit=101", "limit=abc", "type=people"])
    def test_bad_parameters_are_400(self, client, query):
        r = client.get(f"/api/entities/search?q=a&{query}")
        assert r.status_code == 400
        assert "error" in r.get_json()

    def test_empty_query_returns_empty_list(self, client):
        r = client.get("/api/entities/search?q=")
        assert r.status_code == 200 and r.get_json() == []

    def test_does_not_shadow_entity_lists(self, client):
        # /search must not be swallowed by /<entity_type>, nor the reverse.
        assert client.get("/api/entities/search?q=a").status_code == 200
        assert client.get("/api/entities/authors").status_code == 200

    def test_search_is_fast(self, client, flask_module):
        import time
        start = time.perf_counter()
        for q in ["kalidasa", "krishna", "a", "tantraloka", "xyzzy"]:
            flask_module.SEARCH_INDEX.search(q)
        assert (time.perf_counter() - start) / 5 < 0.25  # generous; ~20 ms locally


# --- /api/entities/<type> and /labels (existing endpoints) --------------------

class TestEntities:
    @pytest.mark.parametrize("kind", ["authors", "works", "all"])
    def test_lists_unchanged(self, client, kind):
        data = client.get(f"/api/entities/{kind}").get_json()
        assert data and set(data[0]) == {"id", "label"}

    def test_unknown_list_type_is_400(self, client):
        assert client.get("/api/entities/people").status_code == 400

    def test_labels_include_type_and_name(self, client):
        data = client.get(f"/api/entities/labels?ids={NYAYASARA},{BHASARVAJNA}").get_json()
        assert [(d["id"], d["type"], d["label"]) for d in data] == [
            (NYAYASARA, "work", "Nyāyasāra"),
            (BHASARVAJNA, "author", "Bhāsarvajña"),
        ]
        assert data[0]["name"] == data[0]["label"]

    def test_labels_skip_unknown_ids(self, client):
        # Used to raise (and answer 500) on any unknown ID in the list.
        r = client.get(f"/api/entities/labels?ids={NYAYASARA},999999999")
        assert r.status_code == 200
        assert [d["id"] for d in r.get_json()] == [NYAYASARA]

    def test_labels_all_unknown_is_400(self, client):
        assert client.get("/api/entities/labels?ids=999999999").status_code == 400

    def test_labels_bad_characters_is_400(self, client):
        assert client.get("/api/entities/labels?ids=89000;drop").status_code == 400


# --- /api/graph/subgraph --------------------------------------------------------

class TestSubgraph:
    def test_basic_graph(self, client):
        r = post_graph(client, works=[NYAYASARA], hops=1)
        assert r.status_code == 200
        body = r.get_json()
        assert body["parameters"]["expand"] == []
        nodes = {n["id"]: n for n in body["graph"]["nodes"]}
        assert nodes[NYAYASARA]["is_central"] is True
        assert BHASARVAJNA in nodes
        for n in nodes.values():
            assert {"id", "label", "type", "is_central", "is_excluded", "is_expanded",
                    "etext_links", "hidden_neighbors", "dates"} <= set(n)

    def test_every_edge_has_a_known_relationship(self, client):
        edges = post_graph(client, authors=[ABHINAVAGUPTA], hops=2).get_json()["graph"]["edges"]
        assert edges
        assert {e["relationship"] for e in edges} <= {
            "source author wrote target work",
            "source base text inspired target commentary",
        }

    def test_edges_only_join_nodes_in_the_graph(self, client):
        body = post_graph(client, authors=[ABHINAVAGUPTA], hops=2).get_json()["graph"]
        ids = {n["id"] for n in body["nodes"]}
        assert all(e["source"] in ids and e["target"] in ids for e in body["edges"])

    def test_hidden_neighbors_counts_what_is_off_screen(self, client, flask_module):
        from grapher import neighbor_ids
        r = post_graph(client, authors=[ABHINAVAGUPTA], hops=0)
        node = r.get_json()["graph"]["nodes"][0]
        degree = len(set(neighbor_ids(flask_module.ENTITIES_BY_ID[ABHINAVAGUPTA])))
        assert node["hidden_neighbors"] == degree > 0
        # One hop out shows all of them.
        r = post_graph(client, authors=[ABHINAVAGUPTA], hops=1)
        center = next(n for n in r.get_json()["graph"]["nodes"] if n["id"] == ABHINAVAGUPTA)
        assert center["hidden_neighbors"] == 0

    def test_expand_grows_the_graph_in_place(self, client):
        base = node_ids(post_graph(client, works=[NYAYASARA], hops=1))
        r = post_graph(client, works=[NYAYASARA], hops=1, expand=[BHASARVAJNA])
        grown = node_ids(r)
        assert base < grown  # strictly more, and everything kept
        flags = {n["id"]: n for n in r.get_json()["graph"]["nodes"]}
        assert flags[BHASARVAJNA]["is_expanded"] is True
        assert flags[BHASARVAJNA]["hidden_neighbors"] == 0

    def test_collapse_marks_node_and_trims(self, client):
        full = node_ids(post_graph(client, works=[NYAYASARA], hops=2))
        r = post_graph(client, works=[NYAYASARA], hops=2, exclude_list=[BHASARVAJNA])
        trimmed = node_ids(r)
        assert trimmed < full
        flags = {n["id"]: n for n in r.get_json()["graph"]["nodes"]}
        assert flags[BHASARVAJNA]["is_excluded"] is True

    def test_expand_wins_over_exclude(self, client):
        r = post_graph(client, works=[NYAYASARA], hops=1, exclude_list=[BHASARVAJNA], expand=[BHASARVAJNA])
        flags = {n["id"]: n for n in r.get_json()["graph"]["nodes"]}
        assert flags[BHASARVAJNA]["is_excluded"] is False
        assert flags[BHASARVAJNA]["is_expanded"] is True

    def test_remove_takes_a_node_off_with_what_only_it_brought(self, client):
        full = node_ids(post_graph(client, works=[NYAYASARA], hops=2))
        r = post_graph(client, works=[NYAYASARA], hops=2, remove=[BHASARVAJNA])
        assert r.status_code == 200
        trimmed = node_ids(r)
        assert BHASARVAJNA in full and BHASARVAJNA not in trimmed
        assert trimmed < full
        body = r.get_json()
        assert body["parameters"]["remove"] == [BHASARVAJNA]
        # Nothing left on screen still points at the removed node...
        assert all(BHASARVAJNA not in (e["source"], e["target"]) for e in body["graph"]["edges"])
        # ...or counts it as a connection waiting to be expanded.
        center = next(n for n in body["graph"]["nodes"] if n["id"] == NYAYASARA)
        assert center["hidden_neighbors"] == 0

    def test_remove_ignores_what_was_searched_for(self, client):
        r = post_graph(client, works=[NYAYASARA], hops=1, remove=[NYAYASARA])
        assert NYAYASARA in node_ids(r)

    def test_duplicate_ids_are_harmless(self, client):
        a = node_ids(post_graph(client, works=[NYAYASARA, NYAYASARA], hops=1))
        b = node_ids(post_graph(client, works=[NYAYASARA], hops=1))
        assert a == b

    @pytest.mark.parametrize("body, message", [
        ({"hops": 1}, "require either"),
        ({"works": [NYAYASARA], "hops": -1}, "hops"),
        ({"works": [NYAYASARA], "hops": "2"}, "hops"),
        ({"works": [NYAYASARA], "hops": True}, "hops"),
        ({"works": [NYAYASARA], "hops": 1, "expand": "89000"}, "expand"),
        ({"works": ["not-an-id"], "hops": 1}, "Invalid ID"),
        ({"works": [NYAYASARA], "hops": 1, "expand": ["999999999"]}, "Invalid ID"),
        ({"works": [NYAYASARA], "hops": 1, "remove": "89000"}, "remove"),
        ({"works": [NYAYASARA], "hops": 1, "remove": ["999999999"]}, "Invalid ID"),
    ])
    def test_bad_requests_are_400_with_a_message(self, client, body, message):
        r = client.post("/api/graph/subgraph", json=body)
        assert r.status_code == 400
        assert message in r.get_json()["error"]


# --- Pages ------------------------------------------------------------------------

def initial_params(html):
    """Pull window.initialParams out of a rendered page."""
    match = re.search(r"window\.initialParams = (.*?);\n", html)
    assert match, "page has no window.initialParams"
    return json.loads(match.group(1))


class TestPages:
    def test_index_loads_new_frontend_only(self, client):
        html = client.get("/").get_data(as_text=True)
        assert "js/app.js" in html and "css/app.css" in html
        assert 'id="graph-canvas"' in html
        for gone in ["jquery", "select2", "dropdown.js", "graph.js"]:
            assert gone not in html.lower()
        assert initial_params(html) is None

    def test_index_assets_exist(self, client):
        html = client.get("/").get_data(as_text=True)
        for path in re.findall(r'(?:src|href)="(/static/[^"]+)"', html):
            assert client.get(path).status_code == 200, path

    def test_every_js_module_import_resolves(self, client):
        """Each `import ... from './x.js'` in static/js points at a file the server serves."""
        import os
        js_dir = os.path.join("static", "js")
        for name in os.listdir(js_dir):
            source = open(os.path.join(js_dir, name), encoding="utf8").read()
            for target in re.findall(r"from '\./([^']+)'", source):
                assert client.get(f"/static/js/{target}").status_code == 200, f"{name} → {target}"

    def test_view_passes_parameters_through(self, client):
        html = client.get(f"/view?works={NYAYASARA}&authors={BHASARVAJNA}&hops=2"
                          f"&exclude_list={KALIDASA}&expand={ABHINAVAGUPTA}&remove={KALIDASA}").get_data(as_text=True)
        assert initial_params(html) == {
            "authors": [BHASARVAJNA],
            "works": [NYAYASARA],
            "hops": 2,
            "exclude_list": [KALIDASA],
            "expand": [ABHINAVAGUPTA],
            "remove": [KALIDASA],
        }

    def test_view_defaults(self, client, flask_module):
        params = initial_params(client.get(f"/view?works={NYAYASARA}").get_data(as_text=True))
        assert params["hops"] == flask_module.DEFAULT_HOPS
        assert params["expand"] == [] and params["exclude_list"] == [] and params["remove"] == []

    @pytest.mark.parametrize("query", ["hops=two", "authors=85303;x", "expand=a,b", "remove=a;b"])
    def test_view_rejects_bad_parameters(self, client, query):
        assert client.get(f"/view?works={NYAYASARA}&{query}").status_code == 400

    def test_seti_collection_view_still_renders(self, client, flask_module):
        collection = flask_module.VALID_COLLECTIONS[0]
        r = client.get(f"/seti/by_collection/{collection}/visualize")
        assert r.status_code == 200
        params = initial_params(r.get_data(as_text=True))
        assert params["works"] and params["hops"] == 0 and params["expand"] == [] and params["remove"] == []
        assert params["repulsion"] == 50

    def test_seti_page_describes_the_new_panel(self, client):
        html = client.get("/seti").get_data(as_text=True)
        assert "right-click" not in html
        assert "details panel" in html

    @pytest.mark.parametrize("path", INFO_PAGES)
    def test_other_pages_still_render(self, client, path):
        assert client.get(path).status_code == 200

    @pytest.mark.parametrize("path", INFO_PAGES)
    def test_info_pages_share_one_layout(self, client, path):
        """Every info page has the shared header: name back to the graph, page links, dark mode."""
        html = client.get(path).get_data(as_text=True)
        assert "css/info.css" in html and "js/info.js" in html
        assert 'class="info-name"' in html and 'class="dark-toggle"' in html
        # The saved theme is applied in <head>, before the page draws.
        assert html.index("panditya-theme") < html.index("<body")
        # The header marks the section the page belongs to.
        expected = {"/seti": "/seti", "/tutorials": "/tutorials"}.get(path, "/about")
        assert re.findall(r'<a href="([^"]+)" aria-current="page">', html) == [expected]
        # Notes pages lead back to About.
        assert ('class="crumbs"' in html) == path.startswith("/notes/")

    @pytest.mark.parametrize("path", INFO_PAGES)
    def test_info_pages_put_no_list_inside_a_paragraph(self, client, path):
        """A <ul> can't sit in a <p>: browsers close the <p> early and the spacing goes wrong."""
        html = client.get(path).get_data(as_text=True)
        assert not re.search(r"<p>(?:(?!</p>).)*<ul", html, re.S)


def test_search_box_chips_are_capped():
    """The chip list scrolls inside the box instead of growing without limit (the old Select2 fix)."""
    css = open("static/css/app.css", encoding="utf8").read()
    block = re.search(r"\.chip-search \.chips \{(.*?)\}", css, re.S).group(1)
    assert "max-height" in block and "overflow-y: auto" in block


def test_dark_toggle_icon_follows_the_theme():
    """Moon in light mode, sun in dark mode, chosen by CSS from data-theme (no flicker)."""
    css = open("static/css/app.css", encoding="utf8").read()
    assert ".dark-toggle .icon-sun," in css
    assert '[data-theme="dark"] .dark-toggle .icon-moon' in css
    assert '[data-theme="dark"] .dark-toggle .icon-sun' in css


def test_hint_and_legend_do_not_overlap():
    """Hint clear of the closed legend, hidden while it's open, and at the top on phones."""
    css = open("static/css/app.css", encoding="utf8").read()
    assert "#legend[open] ~ #hint-text" in css
    phone = css[css.index("@media (max-width: 768px)"):]
    block = re.search(r"\n  #hint-text \{(.*?)\}", phone, re.S).group(1)
    assert "top: 8px" in block and "bottom: auto" in block


def test_slash_hint_hidden_on_phones():
    css = open("static/css/app.css", encoding="utf8").read()
    assert re.search(r"@media \(hover: none\), \(max-width: 768px\) \{\s*\.key-hint \{ display: none; \}", css)
    assert 'class="key-hint"' in open("templates/index.html", encoding="utf8").read()
