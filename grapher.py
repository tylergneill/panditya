from copy import deepcopy
from typing import Dict

import networkx as nx

from data_models import Work, Author
from utils.load import load_entities, load_link_data
from utils.utils import load_config_dict_from_json_file, time_execution

config_dict = load_config_dict_from_json_file()
DEFAULT_AUTHORS = config_dict["authors"]
DEFAULT_WORKS = config_dict["works"]
DEFAULT_HOPS = config_dict["hops"]
DEFAULT_EXCLUDE_LIST = config_dict["exclude_list"]
draw_networkx_graph = config_dict["draw_networkx_graph"]
networkx_figure_size = config_dict["networkx_figure_size"]
output_gephi_file = config_dict["output_gephi_file"]

ENTITIES_BY_ID = load_entities()
ETEXT_LINKS, _ = load_link_data()


@time_execution
def construct_subgraph(
    subgraph_center: list = DEFAULT_AUTHORS+DEFAULT_WORKS,
    hops: int = DEFAULT_HOPS,
    exclude_list: list = DEFAULT_EXCLUDE_LIST,
    entities_by_id: Dict[str, Author | Work] = ENTITIES_BY_ID,
):

    subgraph = nx.DiGraph()  # nx graph object; used are:
    # .nodes attribute
    # .add_edge and .remove_node methods (not .add_node)

    subgraph_node_ids = []  # Entity objects
    node_ids_to_append_this_time = subgraph_center  # list of 5-digit strings

    for i in range(hops + 1):

        node_ids_to_append_next_time = []

        for node_id in node_ids_to_append_this_time:

            # append
            subgraph_node_ids.append(node_id)

            # don't do anything else for things on exclude_list
            if node_id in exclude_list:
                continue

            # create edges and queue up connected nodes for next time
            entity: Work | Author = entities_by_id[node_id]
            if entity.type == 'work':

                for author_id in entity.author_ids:
                    node_ids_to_append_next_time.append(author_id)
                    subgraph.add_edge(author_id, entity.id, arrowstyle='-[')

                for base_text_id in entity.base_text_ids:
                    node_ids_to_append_next_time.append(base_text_id)
                    subgraph.add_edge(base_text_id, entity.id, arrowstyle='->')

                for commentary_id in entity.commentary_ids:
                    node_ids_to_append_next_time.append(commentary_id)
                    subgraph.add_edge(entity.id, commentary_id, arrowstyle='->')

                if entity.author_ids == entity.base_text_ids == entity.commentary_ids == []:
                    subgraph.add_node(entity.id)

            elif entity.type == 'author':

                for work_id in entity.work_ids:
                    node_ids_to_append_next_time.append(work_id)
                    subgraph.add_edge(entity.id, work_id, arrowstyle='-[')

                if not entity.work_ids:
                    subgraph.add_node(entity.id)

        # de-dupe, first list-internally (keeping first-seen order, so results
        # are deterministic), then against nodes already in the subgraph.
        # (This used to remove items from the list while looping over it, which
        # skips elements and let already-visited nodes be expanded again.)
        already_in = set(subgraph_node_ids)
        node_ids_to_append_this_time = [
            node_id for node_id in dict.fromkeys(node_ids_to_append_next_time)
            if node_id not in already_in
        ]

    # trim queued-up but unestablished periphery nodes

    for n in list(subgraph.nodes):
        if n not in subgraph_node_ids:
            subgraph.remove_node(n)

    return subgraph


def neighbor_ids(entity: Work | Author) -> list:
    """
    Every entity directly connected to ``entity`` in the full Pandit data:
    a work's authors, base texts and commentaries, or an author's works.
    """
    if entity.type == 'work':
        return list(entity.author_ids) + list(entity.base_text_ids) + list(entity.commentary_ids)
    return list(entity.work_ids)


def construct_graph(
    subgraph_center: list,
    hops: int,
    exclude_list: list,
    expand_list: list = (),
    entities_by_id: Dict[str, Author | Work] = ENTITIES_BY_ID,
) -> nx.DiGraph:
    """
    The graph the interface shows: the usual subgraph around ``subgraph_center``,
    plus one extra hop around each node in ``expand_list``.

    ``expand_list`` is what lets the interface grow a graph in place: when the user
    expands a node, the browser asks again with that node added to the list, and
    the URL can carry the list so the same graph can be rebuilt later. Expanding a
    node overrides "don't expand" for that node only.
    """
    graph = construct_subgraph(subgraph_center, hops, exclude_list, entities_by_id)
    for node_id in expand_list:
        others_excluded = [x for x in exclude_list if x != node_id]
        graph = nx.compose(graph, construct_subgraph([node_id], 1, others_excluded, entities_by_id))
    return graph


def count_hidden_neighbors(graph: nx.DiGraph, node_id: str, entities_by_id: Dict[str, Author | Work] = ENTITIES_BY_ID) -> int:
    """How many of ``node_id``'s neighbours in the full data are not in ``graph``."""
    shown = set(graph.predecessors(node_id)) | set(graph.successors(node_id))
    return len(set(neighbor_ids(entities_by_id[node_id])) - shown - {node_id})


def assign_node_labels_and_colors(subgraph):

    node_ids = list(subgraph.nodes)
    label_map = {}  # dict
    color_map = []  # list
    for node_id in node_ids:

        label_map[node_id] = ENTITIES_BY_ID[node_id].name

        if ENTITIES_BY_ID[node_id].id in DEFAULT_EXCLUDE_LIST:
            color_map.append('gray')

        elif ENTITIES_BY_ID[node_id].type == 'work':
            color_map.append('red')

        elif ENTITIES_BY_ID[node_id].type == 'author':
            color_map.append('green')

    return label_map, color_map


def annotate_graph(graph: nx.DiGraph, selected_entities, exclude_list, expand_list=()) -> nx.DiGraph:
    """
    Annotate graph nodes with `is_central`, `is_excluded` and `is_expanded` flags,
    and also e-text link data.

    Args:
        graph (nx.DiGraph): the graph to annotate (modified in place).
        selected_entities (list): work/author IDs selected as central.
        exclude_list (list): IDs not to expand.
        expand_list (list): IDs expanded by one extra hop (see construct_graph).

    Returns:
        nx.DiGraph: the same graph, annotated.
    """
    etext_link_data = {wid: ETEXT_LINKS[wid] for wid in graph.nodes if wid in ETEXT_LINKS}

    for node in graph.nodes:
        graph.nodes[node]['is_central'] = node in selected_entities
        graph.nodes[node]['is_excluded'] = node in exclude_list and node not in expand_list
        graph.nodes[node]['is_expanded'] = node in expand_list
        if node in etext_link_data:
            graph.nodes[node]['etext_links'] = etext_link_data[node]
    return graph


def export_to_gephi(subgraph, label_map, color_map, output_fn="pandit_grapher_output.gexf"):
    """
    Export a NetworkX graph to a GEXF file for Gephi with proper node labels and colors.
    """
    rgb_map = {
        "red": {'r': 255, 'g': 0, 'b': 0},
        "green": {'r': 6, 'g': 200, 'b': 50},
        "gray": {'r': 128, 'g': 128, 'b': 128},
    }

    # Create a deep copy of the graph to modify safely
    gexf_graph = deepcopy(subgraph)

    # Add labels and visualization attributes
    for i, node_id in enumerate(gexf_graph.nodes):
        gexf_graph.nodes[node_id]["label"] = label_map.get(node_id, f"Node {node_id}")
        if color_map[i] in rgb_map:
            gexf_graph.nodes[node_id]['viz'] = {
                'color': rgb_map[color_map[i]]
            }

    # Write the graph to a GEXF file
    nx.write_gexf(gexf_graph, output_fn, version="1.2draft")
    print(f"GEXF file exported to {output_fn}")


def draw_nx_graph(subgraph, label_map, color_map):
    # Offline mode only (requirements_offline.in); the web app never draws.
    import matplotlib.pyplot as plt
    plt.figure(1, figsize=tuple(networkx_figure_size))
    nx.draw_spring(subgraph, labels=label_map, node_color=color_map, node_size=1000)
    plt.show()


if __name__ == "__main__":

    subgraph = construct_subgraph(DEFAULT_AUTHORS + DEFAULT_WORKS, DEFAULT_HOPS, DEFAULT_EXCLUDE_LIST)

    label_map, color_map = assign_node_labels_and_colors(subgraph)

    if output_gephi_file:
        export_to_gephi(subgraph, label_map, color_map)

    if draw_networkx_graph:
        draw_nx_graph(subgraph, label_map, color_map)
