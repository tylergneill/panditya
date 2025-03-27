import networkx as nx
from typing import Dict
from collections import defaultdict
import community.community_louvain as community_louvain
import numpy as np
import matplotlib.pyplot as plt
import os

from utils.load import load_entities
from data_models import Entity
from grapher import construct_subgraph
from utils.utils import time_execution


SIZE_CATEGORIES = {
    "isolated": (1, 1),
    "extra_small": (2, 4),
    "small": (5, 9),
    "medium": (10, 25),
    "large": (25, 100),
    "extra_large": (101, 10_000),
}

DATA_ANALYSIS_RESULTS_DIR = "data/analysis_results"
COMPONENT_INFO_DIR = "component_info"

@time_execution
def analyze_components(G: nx.DiGraph) -> Dict:
    """
    Analyze connected components of the graph

    Returns:
        dict: Dictionary containing component analysis metrics
    """
    # Convert to undirected for component analysis
    G_undirected = G.to_undirected()

    # Get all connected components
    components = list(nx.connected_components(G_undirected))

    def classify_components_by_size(components):
        """
        Classify components into size categories and calculate histograms.
        """
        # Pre-bin components by size
        size_bins = defaultdict(list)
        for component in components:
            size_bins[len(component)].append(component)

        # Initialize results
        results = {
            name: {
                "components": [],
                "node_count": 0,
                "component_count": 0,
                "size_histogram": defaultdict(int)
            }
            for name in SIZE_CATEGORIES
        }

        # Distribute pre-binned components into categories
        for category, (lower_bound, upper_bound) in SIZE_CATEGORIES.items():
            for size in range(lower_bound, upper_bound + 1):
                for component in size_bins.get(size, []):
                    results[category]["components"].append(component)
                    results[category]["node_count"] += size
                    results[category]["size_histogram"][size] += 1
            results[category]["component_count"] = len(results[category]["components"])

        return results

    category_stats = classify_components_by_size(components)

    return {
        'total_components': len(components),
        **category_stats,
    }


@time_execution
def misc_metrics(G: nx.DiGraph, entities_by_id: Dict[str, Entity]):
    """
    Calculate counts, density, and degrees

    Args:
        G: NetworkX directed graph
        entities_by_id: Dictionary mapping entity IDs to Entity objects

    Returns:
        dict: Dictionary containing various network metrics
    """
    metrics = {}

    # Basic network statistics
    metrics['num_nodes'] = G.number_of_nodes()
    metrics['num_edges'] = G.number_of_edges()
    metrics['density'] = nx.density(G)

    # Node type distribution
    node_types = defaultdict(int)
    for node in G.nodes():
        node_type = entities_by_id[node].type
        node_types[node_type] += 1
    metrics['node_type_distribution'] = dict(node_types)

    # Degree distributions
    in_degrees = [d for n, d in G.in_degree()]
    out_degrees = [d for n, d in G.out_degree()]
    total_degrees = [d for n, d in G.degree()]

    metrics['degree_stats'] = {
        'max_in_degree': max(in_degrees),
        'max_out_degree': max(out_degrees),
        'avg_in_degree': np.mean(in_degrees),
        'avg_out_degree': np.mean(out_degrees),
        'avg_total_degree': np.mean(total_degrees)
    }

    return metrics


@time_execution
def analyze_communities(G: nx.DiGraph) -> Dict:
    """Analyze community structure"""
    # Convert to undirected for community detection
    G_undirected = G.to_undirected()

    # Detect communities using Louvain method
    communities = community_louvain.best_partition(G_undirected)

    # Analyze community sizes
    community_sizes = defaultdict(int)
    for node, community_id in communities.items():
        community_sizes[community_id] += 1

    return {
        'num_communities': len(set(communities.values())),
        'community_sizes': dict(community_sizes),
        'node_communities': communities
    }


@time_execution
def analyze_connection_patterns(G: nx.DiGraph, entities_by_id: Dict[str, Entity]) -> Dict:
    """Analyze patterns of connections between different entity types"""
    patterns = defaultdict(int)

    for edge in G.edges():
        source_type = entities_by_id[edge[0]].type
        target_type = entities_by_id[edge[1]].type
        patterns[f"{source_type}->{target_type}"] += 1

    return dict(patterns)


@time_execution
def analyze_centrality(G: nx.DiGraph) -> Dict:
    """Calculate various centrality metrics"""
    centrality_metrics = {}

    # Degree centrality
    centrality_metrics['in_degree'] = nx.in_degree_centrality(G)
    centrality_metrics['out_degree'] = nx.out_degree_centrality(G)

    # Betweenness centrality
    centrality_metrics['betweenness'] = nx.betweenness_centrality(G)

    # Eigenvector centrality (try/except because it might not converge)
    try:
        centrality_metrics['eigenvector'] = nx.eigenvector_centrality(G)
    except:
        centrality_metrics['eigenvector'] = None

    return centrality_metrics


@time_execution
def find_influential_nodes(centrality_metrics: Dict, entities_by_id: Dict[str, Entity], top_n: int = 10) -> Dict:
    """
    Find the most influential nodes based on various metrics

    Args:
        G: NetworkX directed graph
        entities_by_id: Dictionary mapping entity IDs to Entity objects
        top_n: Number of top nodes to return for each metric

    Returns:
        dict: Dictionary containing lists of top nodes for different metrics
    """
    influential_nodes = {}
    for metric_name, metric_values in centrality_metrics.items():
        if metric_values is None:
            continue

        # Sort nodes by metric value
        sorted_nodes = sorted(metric_values.items(), key=lambda x: x[1], reverse=True)[:top_n]

        # Add entity information
        influential_nodes[metric_name] = [
            {
                'id': node_id,
                'type': entities_by_id[node_id].type,
                'name': entities_by_id[node_id].name,
                'score': score
            }
            for node_id, score in sorted_nodes
        ]

    return influential_nodes


@time_execution
def analyze_temporal_patterns(G: nx.DiGraph, entities_by_id: Dict[str, Entity]) -> Dict:
    """
    Analyze commentary chains and citation patterns

    Returns:
        dict: Dictionary containing temporal pattern metrics
    """
    patterns = {
        'max_commentary_chain': 0,
        'commentary_chain_lengths': [],
        'branching_factors': []
    }

    def get_commentary_chain_length(work_id: str, visited: set) -> int:
        """Recursively measure commentary chain length"""
        if work_id in visited:
            return 0

        visited.add(work_id)
        entity = entities_by_id[work_id]

        if entity.type != 'work' or not entity.commentary_ids:
            return 1

        max_subchain = 0
        for commentary_id in entity.commentary_ids:
            subchain_length = get_commentary_chain_length(commentary_id, visited)
            max_subchain = max(max_subchain, subchain_length)

        return 1 + max_subchain

    # Analyze commentary chains
    for node in G.nodes():
        entity = entities_by_id[node]
        if entity.type == 'work' and not entity.base_text_ids:  # Root works
            chain_length = get_commentary_chain_length(node, set())
            patterns['commentary_chain_lengths'].append(chain_length)
            patterns['max_commentary_chain'] = max(
                patterns['max_commentary_chain'],
                chain_length
            )

    # Calculate branching factors
    for node in G.nodes():
        entity = entities_by_id[node]
        if entity.type == 'work':
            num_commentaries = len(entity.commentary_ids)
            if num_commentaries > 0:
                patterns['branching_factors'].append(num_commentaries)

    if patterns['branching_factors']:
        patterns['avg_branching_factor'] = np.mean(patterns['branching_factors'])

    return patterns


def write_component_summary(component_info: Dict, total_nodes: int, output_dir: str = COMPONENT_INFO_DIR):
    """
    Write summary statistics about components to a file.

    Args:
        component_info: Dictionary containing component analysis results
        total_nodes: Total number of nodes in the graph
        output_dir: Directory where to save the output file
    """
    # Ensure output directory exists
    full_output_dir = os.path.join(DATA_ANALYSIS_RESULTS_DIR, output_dir)
    os.makedirs(full_output_dir, exist_ok=True)

    # Write summary to file
    with open(os.path.join(full_output_dir, 'component_summary.txt'), 'w') as f:
        f.write(f"Total nodes: {total_nodes}\n")
        f.write(
            f"Isolated nodes: {component_info['isolated']['node_count']} in {component_info['isolated']['component_count']} components\n"
        )
        for k,v in list(SIZE_CATEGORIES.items())[1:]:
            f.write(
                f"{k.capitalize().replace('_', ' ')} components ({v[0]}-{v[1]} nodes): {component_info[k]['node_count']} nodes in {component_info[k]['component_count']} components\n"
            )


def write_component_names(component_info: Dict, entities_by_id: Dict[str, Entity],
                          output_dir: str = COMPONENT_INFO_DIR):
    """
    Write readable names for each entity in each component of a category to a separate file.

    Args:
        components: List of sets of entity IDs representing components
        entities_by_id: Dictionary mapping entity IDs to Entity objects
        output_dir: Directory where to save the output files
    """
    # Ensure output directory exists
    full_output_dir = os.path.join(DATA_ANALYSIS_RESULTS_DIR, output_dir)
    os.makedirs(full_output_dir, exist_ok=True)

    for k in list(SIZE_CATEGORIES.keys()):

        # Create filename from category
        filename = os.path.join(full_output_dir, f"{k}_components.txt")

        components = component_info[k]['components']

        with open(filename, 'w') as f:
            f.write(f"{k.capitalize()} Components:\n")
            for i, component in enumerate(components, 1):
                f.write(f"\nComponent {i}:\n")
                for entity_id in sorted(component):
                    entity = entities_by_id[entity_id]
                    f.write(f"  {entity.name} ({entity.id}) ({entity.type})\n")
                if i < len(components):  # Add separator between components
                    f.write("  ----\n")

@time_execution
def plot_component_histograms(component_info: Dict, output_path: str = 'component_histograms.png'):
    """
    Plot histograms of component sizes for each category.

    Args:
        component_info: Dictionary containing component analysis results
    """
    fig, axs = plt.subplots(3, 1, figsize=(10, 12))
    fig.suptitle('Component Size Distributions', fontsize=14)

    # Plot settings
    categories = [
        (k, f"{k.capitalize().replace('_', ' ')} components ({v[0]}-{v[1]}) nodes")
        for k,v in list(SIZE_CATEGORIES.items())[1:-2]
    ]

    for idx, (category, title) in enumerate(categories):
        if component_info[category]['size_histogram']:
            sizes = list(component_info[category]['size_histogram'].keys())
            counts = list(component_info[category]['size_histogram'].values())

            axs[idx].bar(sizes, counts)
            axs[idx].set_title(
                f"{title}\n{component_info[category]['node_count']} nodes in {component_info[category]['component_count']} components")
            axs[idx].set_xlabel('Component Size (nodes)')
            axs[idx].set_ylabel('Number of Components')

            # Set integer ticks on x-axis
            min_size = min(sizes)
            max_size = max(sizes)
            axs[idx].set_xticks(range(min_size, max_size + 1))

            # Add value labels on top of each bar
            for i, count in enumerate(counts):
                if count > 0:  # Only add label if there are components of this size
                    axs[idx].text(sizes[i], count, str(count),
                                  ha='center', va='bottom')

    plt.tight_layout()
    full_output_path = os.path.join(DATA_ANALYSIS_RESULTS_DIR, COMPONENT_INFO_DIR, output_path)
    plt.savefig(full_output_path, dpi=300, bbox_inches='tight')
    plt.close()


@time_execution
def plot_complete_histogram(
    component_info: Dict,
    output_path: str = 'complete_component_distribution.png',
    include_small: bool = True,
):
    """
    Plot a single histogram showing the distribution of ALL component sizes, including isolated nodes.

    Args:
        component_info: Dictionary containing component analysis results
        output_path: Path where to save the plot
    """
    # Combine all histograms and include isolated nodes
    combined_histogram = defaultdict(int)

    # Add isolated nodes if requested
    if include_small:
        combined_histogram[1] = component_info['isolated']['component_count']

    # Add other categories
    for category in list(SIZE_CATEGORIES.keys())[1:-2]:
        if component_info[category]['size_histogram']:
            for size, count in component_info[category]['size_histogram'].items():
                if not include_small and size == 2:
                    continue
                combined_histogram[size] += count

    # Convert to lists for plotting
    sizes = list(combined_histogram.keys())
    counts = list(combined_histogram.values())

    # Create the plot
    plt.figure(figsize=(15, 8))
    plt.bar(sizes, counts)

    # Add title and labels
    total_nodes = sum(size * count for size, count in combined_histogram.items())
    total_components = sum(counts)
    plt.title(f'Complete Component Size Distribution\n{total_nodes} nodes in {total_components} components')
    plt.xlabel('Component Size (nodes)')
    plt.ylabel('Number of Components')

    # Set integer ticks on x-axis
    plt.xticks(range(min(sizes), max(sizes) + 1))

    # Add value labels on top of each bar
    for i, count in enumerate(counts):
        if count > 0:  # Only add label if there are components of this size
            plt.text(sizes[i], count, str(count),
                     ha='center', va='bottom')

    plt.tight_layout()
    full_output_path = os.path.join(DATA_ANALYSIS_RESULTS_DIR, COMPONENT_INFO_DIR, output_path)
    plt.savefig(full_output_path, dpi=300, bbox_inches='tight')
    plt.close()


def write_all_metrics(metrics: Dict):
    """
    Write all network metrics to a file with clear formatting.

    Args:
        metrics: Dictionary containing all network metrics
        output_dir: Directory where to save the output file
    """
    os.makedirs(DATA_ANALYSIS_RESULTS_DIR, exist_ok=True)

    with open(os.path.join(DATA_ANALYSIS_RESULTS_DIR, 'network_metrics.txt'), 'w') as f:
        # Basic network statistics
        f.write("Basic Network Statistics:\n")
        f.write(f"Number of nodes: {metrics['num_nodes']}\n")
        f.write(f"Number of edges: {metrics['num_edges']}\n")
        f.write(f"Network density: {metrics['density']:.6f}\n\n")

        # Node type distribution
        f.write("Node Type Distribution:\n")
        for node_type, count in metrics['node_type_distribution'].items():
            f.write(f"  {node_type}: {count}\n")
        f.write("\n")

        # Degree statistics
        f.write("Degree Statistics:\n")
        for stat_name, value in metrics['degree_stats'].items():
            f.write(f"  {stat_name}: {value:.2f}\n")
        f.write("\n")

        # Community statistics
        f.write("Community Statistics:\n")
        f.write(f"Number of communities: {metrics['communities']['num_communities']}\n")
        f.write("Community sizes:\n")
        for comm_id, size in metrics['communities']['community_sizes'].items():
            f.write(f"  Community {comm_id}: {size} nodes\n")
        f.write("\n")

        # Connection patterns
        f.write("Connection Patterns:\n")
        for pattern, count in metrics['connection_patterns'].items():
            f.write(f"  {pattern}: {count}\n")
        f.write("\n")

        # Temporal patterns
        f.write("Temporal Patterns:\n")
        f.write(f"Maximum commentary chain length: {metrics['temporal_patterns']['max_commentary_chain']}\n")
        if metrics['temporal_patterns'].get('avg_branching_factor'):
            f.write(f"Average branching factor: {metrics['temporal_patterns']['avg_branching_factor']:.2f}\n")
        f.write("\n")

        # Centrality and influential nodes (if available)
        if 'centrality' in metrics and 'influential_nodes' in metrics:
            f.write("Most Influential Nodes:\n")
            for metric_type, nodes in metrics['influential_nodes'].items():
                f.write(f"\nTop nodes by {metric_type}:\n")
                for node in nodes:
                    f.write(f"  {node['name']} ({node['id']}) ({node['type']}): {node['score']:.4f}\n")


if __name__ == "__main__":
    entities_by_id = load_entities()

    # Create full graph (center on all entities, use large number of hops)
    G = construct_subgraph(
        subgraph_center=list(entities_by_id.keys()),
        entities_by_id=entities_by_id,
        hops=25,
    )

    # Compute component metrics
    metrics = {}
    metrics['components'] = analyze_components(G)

    # Output component analysis results to file
    component_info = metrics['components']
    write_component_summary(component_info, len(entities_by_id))
    write_component_names(component_info, entities_by_id)
    plot_component_histograms(component_info)
    plot_complete_histogram(component_info, 'complete_component_distribution_3-23.png', include_small=False)
    plot_complete_histogram(component_info, 'complete_component_distribution.png', include_small=True)

    compute_more_metrics = False
    if compute_more_metrics:
        metrics.update(misc_metrics(G, entities_by_id))
        metrics['communities'] = analyze_communities(G)
        metrics['connection_patterns'] = analyze_connection_patterns(G, entities_by_id)
        metrics['centrality'] = analyze_centrality(G)
        metrics['influential_nodes'] = find_influential_nodes(metrics['centrality'], entities_by_id, top_n=10)
        metrics['temporal_patterns'] = analyze_temporal_patterns(G, entities_by_id)
        write_all_metrics(metrics)

