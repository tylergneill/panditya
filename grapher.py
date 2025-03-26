from copy import deepcopy
from typing import Dict

import networkx as nx
import matplotlib.pyplot as plt

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
ETEXT_LINKS = load_link_data()


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

        # de-dupe, first list-internally, then against previous
        node_ids_to_append_next_time = list(set(node_ids_to_append_next_time))
        for node_id in node_ids_to_append_next_time:
            if node_id in subgraph_node_ids:
                node_ids_to_append_next_time.remove(node_id)

        node_ids_to_append_this_time = node_ids_to_append_next_time

    # trim queued-up but unestablished periphery nodes

    for n in list(subgraph.nodes):
        if n not in subgraph_node_ids:
            subgraph.remove_node(n)

    return subgraph


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


def annotate_graph(graph: nx.DiGraph, selected_entities, exclude_list) -> nx.DiGraph:
    """
    Annotate graph nodes with `isCentral` and `isExcluded` flags, and also e-text link data.

    Args:
        graph (dict): Graph data containing nodes and edges.
        selected_entities (list): List of work/author IDs selected as central.
        exclude_list (list): List of IDs to exclude.

    Returns:
        dict: Annotated graph data.
    """
    etext_link_data = {wid: ETEXT_LINKS[wid] for wid in graph.nodes if wid in ETEXT_LINKS}

    for node in graph.nodes:
        graph.nodes[node]['is_central'] = node in selected_entities
        graph.nodes[node]['is_excluded'] = node in exclude_list
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
