import re
from collections import defaultdict
from typing import Dict, List

from flask import Flask, render_template, Blueprint, jsonify, request, send_from_directory
from flask_restx import Api, Resource, fields

from data_models import Entity
from grapher import construct_subgraph, annotate_graph
from utils.utils import (
    custom_sort_key,
    get_app_version, get_pandit_data_version, get_seti_data_version,
    load_config_dict_from_json_file,
    summarize_etext_links,
)
from utils.load import load_entities, load_link_data

ENTITIES_BY_ID: Dict[str, Entity] = load_entities()
VALID_WORK_IDS: List[str] = [k for k in ENTITIES_BY_ID if ENTITIES_BY_ID[k].type == 'work']
VALID_AUTHOR_IDS: List[str] = [k for k in ENTITIES_BY_ID if ENTITIES_BY_ID[k].type == 'author']

ETEXT_LINKS, ADDITIONAL_COLLECTION_COUNT_DATA = load_link_data()
ETEXT_DATA_SUMMARY = summarize_etext_links(ETEXT_LINKS, ADDITIONAL_COLLECTION_COUNT_DATA)
VALID_COLLECTIONS = list(ETEXT_DATA_SUMMARY.keys())

APP_VERSION = get_app_version()
PANDIT_DATA_VERSION = get_pandit_data_version()
SETI_DATA_VERSION = get_seti_data_version()

config_dict = load_config_dict_from_json_file()
DEFAULT_HOPS = config_dict["hops"]

app = Flask(__name__)

# --- Blueprint setup ---
api_bp = Blueprint('api', __name__, url_prefix='/api')  # API Blueprint
api = Api(api_bp, version=APP_VERSION, title='Pāṇḍitya API',
          description=  f'API for exploring work and author relationships in Pandit database ({PANDIT_DATA_VERSION}) '
                        f'and linking to online e-text repositories (last updated {SETI_DATA_VERSION})',
          doc='/docs')  # Swagger UI available at /api/docs

# --- Define all namespaces ---
entities_ns = api.namespace('entities', description='Entity operations')
graph_ns = api.namespace('graph', description='Graph operations')
seti_ns = api.namespace('seti', description='SETI operations')


def get_date_info(entity: Entity):
    lowest_year, highest_year = entity.lowest_year, entity.highest_year
    caveat_str = ""
    if entity.type == 'work' and not entity.lowest_year and entity.author_lowest_year:
        lowest_year, highest_year = entity.author_lowest_year, entity.author_highest_year
        caveat_str = " (author)"
    if not lowest_year:
        return ""
    date_str = f"{lowest_year}" if lowest_year == highest_year else f"{lowest_year}–{highest_year}"
    return date_str + caveat_str

# --- Preprocess dropdown data ---
entity_dropdown_options = defaultdict(list)
for entity in ENTITIES_BY_ID.values():
    entity_label = f"{entity.name} ({entity.id})"
    date_info = get_date_info(entity)
    if date_info:
        entity_label += f" [{date_info}]"
    if entity.aka:
        entity_label += f" [{entity.aka}]"
    option = {"id": entity.id, "label": entity_label}
    entity_dropdown_options['all'].append(option)
    entity_dropdown_options[entity.type+'s'].append(option)

for key in ['works', 'authors', 'all']:
    entity_dropdown_options[key] = sorted(entity_dropdown_options[key], key=lambda x: custom_sort_key(x['label']))


# --- entities namespace routes ---

def validate_comma_separated_list_input(string_input, allow_empty=False):
    if not string_input or not (stripped_string_input := string_input.strip()):
        if allow_empty:
            return None
        else:
            return {
                "error": "List input must be non-empty."
            }
    if not bool(re.fullmatch(r'[\d,]*', stripped_string_input)):
        return {
            "error": "List input should not contain any characters besides numbers and comma "
                     "(no whitespace, quotation marks, etc.)"
        }
    else:
        return None


@entities_ns.route('/<string:entity_type>')
class EntitiesByType(Resource):
    def get(self, entity_type):
        """
        Fetch list of available IDs for a specific type of node (authors, works, or all).
        Example: /api/entities/works
        Note: Response time in Swagger is much higher than endpoint by itself.
        """
        if entity_type not in ['authors', 'works', 'all']:
            return {"error": "Invalid entity type. Choose from 'authors', 'works', or 'all'."}, 400

        return jsonify(entity_dropdown_options[entity_type])


@entities_ns.route('/labels')
class Labels(Resource):
    @api.doc(
        params={
            'ids': 'Comma-separated list of entity IDs to fetch labels for (e.g., 89000,12345)'
        },
        responses={
            200: 'Labels returned successfully',
            400: 'No IDs provided or other error',
            500: 'Internal server error'
        },
    )
    def get(self):
        """
        Fetch labels for a list of node IDs.
        Example: /api/entities/labels?ids=89000,12345
        """
        ids_param = request.args.get('ids')  # Get all IDs as a list

        # check that input is non-empty and contains correct characters
        err = validate_comma_separated_list_input(ids_param)
        if err is not None:
            return err, 400

        ids = ids_param.strip().split(',')
        if not ids:
            return {"error": "No IDs provided"}, 400

        valid_entity_ids = [id for id in ids if id in ENTITIES_BY_ID]
        if not valid_entity_ids:
            return {"error": "No valid entity IDs provided"}, 400

        label_data = [
            {"id": node_id, "label": ENTITIES_BY_ID[node_id].name}
            for node_id in ids
        ]

        return jsonify(label_data)


# register entities namespace
api.add_namespace(entities_ns)

# --- graph namespace routes ---

# --- Define request model for primary Subgraph endpoint ---
subgraph_model = api.model('SubgraphRequest', {
    'authors': fields.List(fields.String, required=False, description='List of author node IDs', example=[]),
    'works': fields.List(fields.String, required=False, description='List of work node IDs', example=["89000"]),
    'hops': fields.Integer(required=True, description='Number of hops outward from center', example=DEFAULT_HOPS),
    'exclude_list': fields.List(fields.String, required=False, description='List of node IDs to exclude', example=[])
})


def validate_subgraph_inputs(authors, works, hops, exclude_list):
    if not authors and not works:
        return {"error": "require either one or both of authors or works"}
    if not isinstance(hops, int) or hops < 0:
        return {"error": "hops must be a non-negative integer"}
    if not isinstance(exclude_list, list):
        return {"error": "exclude_list must be a list"}
    return None


def get_edge_relationship(source_node_id, target_node_id):
    if (ENTITIES_BY_ID[source_node_id].type, ENTITIES_BY_ID[target_node_id].type) == ('author', 'work'):
        return 'source author wrote target work'
    elif (ENTITIES_BY_ID[source_node_id].type, ENTITIES_BY_ID[target_node_id].type) == ('work', 'work'):
        return 'source base text inspired target commentary'
    else:
        app.logger.error(f"Error: determine_relationship input should be one of ('author', 'work') or ('work', 'work'); "
                         f"instead was: {(ENTITIES_BY_ID[source_node_id].type, ENTITIES_BY_ID[target_node_id].type)}")


@graph_ns.route('/subgraph')
class Subgraph(Resource):
    @graph_ns.expect(subgraph_model)
    def post(self):
        """
        Generate a subgraph based on input parameters.
        """
        try:
            # Parse request data
            data = request.json
            authors = set(data.get('authors', []))
            works = set(data.get('works', []))
            subgraph_center = list(authors | works)  # union
            hops = data.get('hops', DEFAULT_HOPS)
            exclude_list = list(set(data.get('exclude_list', [])))

            # validate_inputs
            err = validate_subgraph_inputs(authors, works, hops, exclude_list)
            if err is not None:
                return err, 400

            # Call the actual construct_subgraph function
            subgraph = construct_subgraph(subgraph_center, hops, exclude_list)

            # Annotate graph data for visual emphasis and e-text links
            annotated_subgraph = annotate_graph(subgraph, subgraph_center, exclude_list)

            # Extract nodes and edges
            filtered_nodes = [
                {
                    "id": node,
                    "label": ENTITIES_BY_ID[node].name,
                    "type": ENTITIES_BY_ID[node].type,
                    "aka": ENTITIES_BY_ID[node].aka,
                    "social_ids": ENTITIES_BY_ID[node].social_identifiers if ENTITIES_BY_ID[node].type == 'author' else None,
                    "dates": get_date_info(ENTITIES_BY_ID[node]),
                    "discipline": ENTITIES_BY_ID[node].discipline if ENTITIES_BY_ID[node].type == 'work' else None,
                    "disciplines": ENTITIES_BY_ID[node].disciplines if ENTITIES_BY_ID[node].type == 'author' else None,
                    "is_central": annotated_subgraph.nodes[node].get('is_central', False),
                    "is_excluded": annotated_subgraph.nodes[node].get('is_excluded', False),
                    "etext_links": annotated_subgraph.nodes[node].get('etext_links', False),
                }
                for node in annotated_subgraph.nodes
            ]
            filtered_edges = [
                {"source": edge[0], "target": edge[1], "relationship": get_edge_relationship(edge[0], edge[1])}
                for edge in subgraph.edges
            ]

            # Construct the response
            response = {
                "parameters": {
                    "authors": list(authors),
                    "works": list(works),
                    "hops": hops,
                    "exclude_list": list(exclude_list),
                },
                "graph": {
                    "nodes": filtered_nodes,
                    "edges": filtered_edges,
                }
            }
            return jsonify(response)

        except KeyError as e:
            app.logger.error('Error: %s', str(e))
            return {"error": f"Invalid ID: {str(e)}"}, 400
        except Exception as e:
            app.logger.error('Error: %s', str(e))
            return {"error": str(e)}, 500


# register graph namespace
api.add_namespace(graph_ns)


# --- SETI namespace routes ---

def get_works_by_collection(collection: str, include_other_collections: bool = False):
    """
    Fetches all works associated with a given collection.

    Args:
        collection (str): The name of the collection to query.
        include_other_collections (bool):
            - False (default): Hide contributions of other collections.
            - True: Also include contributions of other collections.

    Returns:
        tuple: (dict of works, error dict if any, HTTP status code)
    """
    if collection.lower() == "all":
        return ETEXT_LINKS, None, 200  # Return everything

    if collection not in VALID_COLLECTIONS:
        return None, {"error": f"Invalid collection: {collection}. Valid options: {sorted(VALID_COLLECTIONS)}"}, 400

    collection_work_data = {
        work_id: data for work_id, data in ETEXT_LINKS.items() if collection in data
    }
    # Contains contributions of other collections

    if not include_other_collections:
        # Hide contributions of other collections but retain the work
        for work_id in collection_work_data:
            collection_work_data[work_id] = {collection: collection_work_data[work_id][collection]}

    if '...' in collection_work_data:
        collection_work_data.pop('...')

    return collection_work_data, None, 200



@seti_ns.route("/by_collection")
class ByCollection(Resource):
    @api.doc(
        description="Fetch data for all works associated with a given collection.",
        params={
            "collection": f"The name of the collection ({VALID_COLLECTIONS})",
            "include_other_collections": "If true, also returns information about other collections (default: false)"
        },
        responses={
            200: "Works returned successfully",
            400: "Invalid collection name or missing parameter",
            500: "Internal server error"
        }
    )
    def get(self):
            """ Fetch all works associated with a given collection. """
            data = request.args.to_dict()
            collection = data.get("collection")
            include_other_collections = data.get("include_other_collections", "false").lower() == "true"

            if not collection:
                return {"error": "Missing required parameter: collection"}, 400
            elif collection not in VALID_COLLECTIONS:
                return {"error": f"Invalid collection: {collection}. Valid options: {sorted(VALID_COLLECTIONS)}"}, 400

            works_data, error_response, status_code = get_works_by_collection(collection, include_other_collections)

            if error_response:
                return error_response, status_code

            return jsonify(works_data)



@seti_ns.route("/by_collection/unique")
class UniqueToCollection(Resource):
    @api.doc(
        description="Fetch works that belong exclusively to a specified collection.",
        params={
            "collection": f"The name of the collection ({VALID_COLLECTIONS})",
        },
        responses={
            200: "Unique works returned successfully",
            400: "Invalid collection name or missing parameter",
            500: "Internal server error"
        }
    )
    def get(self):
        """ Get works that belong only to the specified collection. """
        data = request.args.to_dict()
        collection = data.get("collection")

        if not collection:
            return {"error": "Missing required parameter: collection"}, 400
        elif collection not in VALID_COLLECTIONS:
            return {"error": f"Invalid collection: {collection}. Valid options: {sorted(VALID_COLLECTIONS)}"}, 400

        # Works that belong **only** to the given collection
        unique_works = {
            work_id: {collection: data[collection]}
            for work_id, data in ETEXT_LINKS.items()
            if collection in data and len(data) == 1  # Only this collection is present
        }

        return jsonify(unique_works)


@seti_ns.route("/by_collection/overlap")
class OverlapBetweenCollections(Resource):
    @api.doc(
        description=f"Determine overlap and unique works between any two collections ({VALID_COLLECTIONS}).",
        params={
            "collection1": "The first collection name (e.g., GRETIL)",
            "collection2": "The second collection name (e.g., SARIT)"
        },
        responses={
            200: "Overlap data returned successfully",
            400: "Invalid collection name(s) or missing parameters",
            500: "Internal server error"
        }
    )
    def get(self):
        """
        Determine overlap and unique works between two collections.
        Example: /api/seti/by_collection/overlap
        """
        data = request.args.to_dict()
        collection1 = data.get("collection1")
        collection2 = data.get("collection2")

        # Ensure both collections are provided
        if not collection1 or not collection2:
            return {"error": "Both collection1 and collection2 are required"}, 400

        # Validate collections
        elif collection1 not in VALID_COLLECTIONS or collection2 not in VALID_COLLECTIONS:
            return {
                "error": f"Invalid collection(s): {collection1}, {collection2}. Valid options: {sorted(VALID_COLLECTIONS)}"
            }, 400

        overlap = {}
        only_in_collection1 = {}
        only_in_collection2 = {}

        for work_id, collections in ETEXT_LINKS.items():
            in_col1 = collection1 in collections
            in_col2 = collection2 in collections

            if in_col1 and in_col2:
                overlap[work_id] = {collection1: collections[collection1], collection2: collections[collection2]}
            elif in_col1:
                only_in_collection1[work_id] = {collection1: collections[collection1]}
            elif in_col2:
                only_in_collection2[work_id] = {collection2: collections[collection2]}

        return jsonify({
            "overlap": overlap,
            f"only_in_{collection1}": only_in_collection1,
            f"only_in_{collection2}": only_in_collection2
        })


@seti_ns.route("/by_work")
class ByWork(Resource):
    @api.doc(
        description="Fetch e-text data for a list of work IDs.",
        params={
            "ids": "Comma-separated list of work IDs (e.g., 111493,42078)"
        },
        responses={
            200: "E-Text link data returned successfully",
            400: "No IDs provided or other error",
            500: "Internal server error"
        }
    )
    def get(self):
        """
        Fetch data for a list of work IDs via GET request.
        Example: /api/seti/by_work?ids=111493,42078
        """
        ids_param = request.args.get('ids')  # Get all IDs as a list

        # check that input is non-empty and contains correct characters
        err = validate_comma_separated_list_input(ids_param)
        if err is not None:
            return err, 400

        ids = ids_param.strip().split(',')
        if not ids:
            return {"error": "No IDs provided"}, 400

        valid_work_ids = [id for id in ids if id in VALID_WORK_IDS]
        if not valid_work_ids:
            return {"error": "No valid work IDs provided"}, 400

        etext_link_data = {wid: ETEXT_LINKS[wid] for wid in valid_work_ids if wid in ETEXT_LINKS}

        return jsonify(etext_link_data)


def get_author_ids_for_work_ids(work_ids: List[str]):
    author_ids = set()
    try:
        for work_id in work_ids:
            author_ids = author_ids | set(ENTITIES_BY_ID[work_id].author_ids)
    except AttributeError as e:
        raise Exception(f"for {work_id=}: {e}")
    return list(author_ids)


@app.route("/seti/by_collection/<string:collection>/visualize")
def visualize_collection(collection: str):
    """
    Prepare full graph data for all works implicated by a given collection
    and render 'index.html' with initial_params.
    Example: /by_collection/GRETIL/visualize
    """
    works_data, error_response, status_code = get_works_by_collection(collection)

    if error_response:
        return error_response, status_code

    works = list(works_data.keys())
    authors = get_author_ids_for_work_ids(works)

    initial_params = {
        "works": works,
        "authors": authors,
        "hops": 0,
        "exclude_list": [],
        "repulsion": 50,
    }

    return render_template("index.html", initial_params=initial_params)


# TODO: Also include file size info!


# register SETI namespace
api.add_namespace(seti_ns)


# --- frontend routes ---

@app.route('/')
def index():
    """
    Serve the main graph interface without initialization variables.
    """
    return render_template('index.html', initial_params=None)


@app.route('/view')
def render_graph_from_URL_params():
    """
    Serve the main graph interface, initializing inputs based on URL parameters.
    """
    try:
        authors_str = request.args.get('authors', None)
        works_str = request.args.get('works', None)
        exclude_list_str = request.args.get('exclude_list', None)

        for var in [authors_str, works_str, exclude_list_str]:
            err = validate_comma_separated_list_input(var, allow_empty=True)
            if err is not None:
                return err, 400

        authors = authors_str.strip().split(',') if authors_str else []
        works = works_str.strip().split(',') if works_str else []
        exclude_list = exclude_list_str.strip().split(',') if exclude_list_str else []

        # Parse URL parameters
        initial_params = {
            "authors": authors,
            "works": works,
            "hops": request.args.get('hops', default=DEFAULT_HOPS),
            "exclude_list": exclude_list,
        }

        # Serve the template with initialization variables
        return render_template('index.html', initial_params=initial_params)
    except Exception as e:
        app.logger.error('Error: %s', str(e))
        return render_template('index.html', initial_params=None, error={"error": str(e)})


@app.route('/about')
def about():
    return render_template('about.html')


@app.route('/notes/author')
def author_notes():
    return render_template('notes/author.html')


@app.route('/notes/data')
def data_notes():
    return render_template('notes/data.html', pandit_data_version=PANDIT_DATA_VERSION, seti_data_version=SETI_DATA_VERSION)


@app.route('/notes/license')
def license_notes():
    return render_template('notes/license.html')


@app.route('/notes/technical')
def tech_notes():
    return render_template('notes/technical.html', app_version=APP_VERSION, pandit_data_version=PANDIT_DATA_VERSION, seti_data_version=SETI_DATA_VERSION)


@app.route('/notes/updates')
def update_notes():
    return render_template('notes/updates.html')


@app.route('/seti')
def seti():
    return render_template('seti.html', pandit_data_version=PANDIT_DATA_VERSION, seti_data_version=SETI_DATA_VERSION, etext_data_summary=ETEXT_DATA_SUMMARY)

@app.route('/tutorials')
def tutorials():
    return render_template('tutorials.html')


# --- data serving route ---

@app.route('/data/<path:filepath>')
def data(filepath):
    return send_from_directory('data', filepath)


# Register the Blueprint
app.register_blueprint(api_bp)


if __name__ == '__main__':
    app.run(debug=True, port=5091)
