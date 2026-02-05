import { refreshDropdowns } from './dropdown.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Check if initialization parameters are provided by the backend
    const initialParams = window.initialParams || null;

    if (initialParams) {
        // Populate dropdowns and inputs
        const authorsDropdown = $('#authors-dropdown');
        const worksDropdown = $('#works-dropdown');
        const excludeDropdown = $('#exclude-list-dropdown');

        if (initialParams.authors.length > 0) {
          await fetchLabelsAndPopulateDropdown(initialParams.authors, authorsDropdown);
        }
        if (initialParams.works.length > 0) {
          await fetchLabelsAndPopulateDropdown(initialParams.works, worksDropdown);
        }
        if (initialParams.exclude_list.length > 0) {
          await fetchLabelsAndPopulateDropdown(initialParams.exclude_list, excludeDropdown);
        }

        // Set hops value
        document.getElementById('hops').value = initialParams.hops;

        // Set initial repulsion if passed
        if (initialParams.repulsion !== undefined) {
            const repulsionSlider = document.getElementById('chargeStrength');
            repulsionSlider.value = initialParams.repulsion;
        }

        // Fetch and render the graph immediately
        const payload = {
          authors: initialParams.authors,
          works: initialParams.works,
          hops: parseInt(initialParams.hops, 10),
          exclude_list: initialParams.exclude_list
        };

        try {
          const response = await fetch('/api/graph/subgraph', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) throw new Error('Failed to generate graph');

          const data = await response.json();
          renderGraph(data.graph); // Render the graph from POST response
        } catch (error) {
          console.error('Error generating graph:', error);
        }
    }


  // Handle form submission for generating graphs
  document.getElementById('fetch-button').addEventListener('click', async () => {
    const authors = $('#authors-dropdown').val(); // Get selected authors
    const works = $('#works-dropdown').val(); // Get selected works
    const hops = document.getElementById('hops').value; // Get hop count
    const exclude_list = $('#exclude-list-dropdown').val(); // Get exclusions

    const payload = {
      authors: authors,
      works: works,
      hops: parseInt(hops, 10),
      exclude_list: exclude_list
    };

    try {
      const response = await fetch('/api/graph/subgraph', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Failed to generate graph');

      const data = await response.json();

      renderGraph(data.graph); // Render the graph from POST response

      // On mobile, close the sidebar to reveal the graph
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.remove('open');
    } catch (error) {
      console.error('Error generating graph:', error);
    }
  });

});

// Core function to render a graph using D3.js
function renderGraph(graph) {
  const svg = d3.select('#graph-svg');
  svg.selectAll('*').remove(); // Clear previous graph

  // Clean up previous ResizeObserver
  if (window._panditya_resizeObserver) {
    window._panditya_resizeObserver.disconnect();
    window._panditya_resizeObserver = null;
  }

  const container = document.getElementById('graph-container');
  let width = container.clientWidth;
  let height = container.clientHeight;

  // Set viewBox so SVG scales properly
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const graphGroup = svg.append('g'); // Group for all elements

  // Define zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([0.1, 3])
    .on('zoom', (event) => graphGroup.attr('transform', event.transform));

  svg.call(zoom);

  // --- Apply an initial trivial transform to avoid weird disappearance and/or shift problems ---
  const initialTransform = d3.zoomIdentity.translate(1, 1).scale(1);
  svg.call(zoom.transform, initialTransform);

  // Fetch initial slider values dynamically
  const initialLinkDistance = +document.getElementById('linkDistance').value;
  const initialChargeStrength = -document.getElementById('chargeStrength').value; // Negative for repulsion
  const initialCollisionRadius = +document.getElementById('collisionRadius').value;

  // Faster decay for small graphs so they settle quickly
  const nodeCount = graph.nodes.length;
  const alphaDecay = nodeCount <= 5 ? 0.08 : nodeCount <= 20 ? 0.05 : 0.0228;

  // Initialize the simulation based on slider values
  const simulation = d3.forceSimulation(graph.nodes)
    .alphaDecay(alphaDecay)
    .force('link', d3.forceLink(graph.edges).id(d => d.id).distance(initialLinkDistance))
    .force('charge', d3.forceManyBody().strength(initialChargeStrength))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide(initialCollisionRadius));

  const link = graphGroup.append('g')
    .selectAll('line')
    .data(graph.edges)
    .join('line')
    .attr('class', 'link')
    .attr('stroke', '#999')
    .attr('stroke-opacity', 0.6);

  const node = graphGroup.append('g')
    .selectAll('circle')
    .data(graph.nodes)
    .join('circle')
    .attr('class', d => `node ${d.type}`)
    .attr('r', d => {
      if (d.is_central) return 17;
      if (d.is_excluded) return 15;
      return 10;
    })
    .style('stroke', d => {
      if (d.type === 'work' && d.etext_links) {
        return 'gold';
      }
      return null; // or 'none'
    })
    .style('stroke-width', d => {
      if (d.type === 'work' && d.etext_links) {
        return 4;
      }
      return 1; // or default
    })
    .call((() => {
      // Long-press state, scoped for the drag callbacks
      let longPressTimer = null;
      let longPressFired = false;
      let dragMoved = false;

      return d3.drag()
        .on('start', event => {
          dragMoved = false;
          longPressFired = false;

          // Start long-press timer (fires context menu if no drag movement)
          const src = event.sourceEvent;
          const isTouchEvent = src && src.touches;
          if (isTouchEvent) {
            const touch = src.touches[0];
            longPressTimer = setTimeout(() => {
              longPressFired = true;
              simulation.alphaTarget(0);
              showNodeContextMenu(
                { pageX: touch.pageX, pageY: touch.pageY, preventDefault: () => {} },
                event.subject
              );
            }, 500);
          }

          if (!event.active) simulation.alphaTarget(0.3).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
        })
        .on('drag', event => {
          // Any movement cancels the long-press
          if (!dragMoved) {
            const dx = event.x - event.subject.fx;
            const dy = event.y - event.subject.fy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
              dragMoved = true;
              clearTimeout(longPressTimer);
            }
          }
          if (!longPressFired) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
          }
        })
        .on('end', event => {
          clearTimeout(longPressTimer);
          if (!event.active) simulation.alphaTarget(0);
          if (!longPressFired) {
            event.subject.fx = null;
            event.subject.fy = null;
          }
          longPressFired = false;
        });
    })())
    .on('contextmenu', (event, d) => {
      event.preventDefault();
      showNodeContextMenu(event, d);
    });

  function showNodeContextMenu(event, d) {
    // Create or show a custom context menu
    let menu = d3.select('.custom-context-menu');
    if (menu.empty()) {
        menu = d3.select('body').append('div')
            .attr('class', 'custom-context-menu');
    }

    // Close any open submenus from previous interactions
    menu.selectAll('.submenu-open').classed('submenu-open', false);

    let etextMenuHtml = '';

    // One entry per "collection".  Each entry is a function that
    // receives (link, collection) and returns a label string.
    //
    // If you don't supply a rule, the generic fallback is used.

    const LABEL_EXTRACTORS = {
      // ---- GRETIL -----------------------------------------------------------
      GRETIL: link => basename(link),

      // ---- DCS --------------------------------------------------------------
      // DCS has three link shapes, but all yield a short ID or title we can grab.
      DCS: link => {
        // • "index.php?…IDTextDisplay=165"   -> 165
        const m = link.match(/IDTextDisplay=(\d+)/);
        if (m) return m[1];

        // • GitHub raw/tree path "…/files/SomeTitle"        -> SomeTitle
        // • My own extractor tree "…/extracted/SomeTitle.txt" -> SomeTitle
        return basename(link);
      },

      // ---- SARIT ------------------------------------------------------------
      SARIT: link => basename(link),

      // ---- Sanskrit Library / TITUS ----------------------------------------
      'Sanskrit Library and TITUS': link => basename(link),

      // ---- Vātāyana / Pramāṇa NLP ------------------------------------------
      'Vātāyana and Pramāṇa NLP': link => {
        const m = link.match(/text_abbrv=([^&]+)/); // HBṬ
        return m ? decodeURIComponent(m[1]) : basename(link);
      },

      // ---- Muktabodha KSTS --------------------------------------------------
      'Muktabodha KSTS': link => {
        const m = link.match(/miri_catalog_number=([^&]+)/); // M00349
        return m ? m[1] : basename(link);
      },

      // ---- UTA Dharmaśāstra -----------------------------------------------
      'UTA Dharmaśāstra': (link, _col, idx, total) => {

        /* 1.  Google-Docs links → "Google Doc", enumerated if multiple */
        if (link.includes('docs.google.com/document')) {
          return total > 1 ? `Google Doc ${idx + 1}` : 'Google Doc';
        }

        /* 2.  UT Austin "sites" links → everything after ".../resources/", no trailing slash */
        const m = link.match(/\/resources\/([^?#]+?)(\/)?$/);   // captures path after /resources/
        if (m) {
          const label = decodeURIComponent(m[1]);               // un-escape things like %e1%b9%a3
          return label;
        }

        /* 3.  Fallback (shouldn't hit, but keeps menu usable) */
        return basename(link);
      },

      // ---- DiPAL DCV --------------------------------------------------------
      'DiPAL DCV': link => {
        /* Prefer tra_id when it exists (translated text). */
        let m = link.match(/tra_id=(\d+)/);
        if (m) return m[1];          // e.g. 77

        /* Otherwise use wor_id (work-level page). */
        m = link.match(/wor_id=(\d+)/);
        if (m) return m[1];          // e.g. 6

        /* Fallback: last path segment / basename */
        return basename(link);
      },
    };

    // helper for the common "take last path segment, no ext"
    function basename(url) {
      if (typeof url !== 'string') return '';
      return url.split(/[/=]/).pop().replace(/\.[^.]+$/, '');
    }

    function getDisplayLabel(collection, link, idx = 0, total = 1) {
      // Prefer explicit rule for this collection
      const extractor = LABEL_EXTRACTORS[collection];
      if (extractor) {
          // pass link, collection, idx, total  → works for UTA Dharmaśāstra rule
          return extractor(link, collection, idx, total);
      }

      // Fallback: same old "basename" heuristic
      return basename(link);
    }

    if (d.etext_links) {
        Object.entries(d.etext_links).forEach(([collection, links]) => {
            let collectionLinks = '';

            // Check if links is an object with categories like 'GitHub' and 'web'
            if (typeof links === 'object' && !Array.isArray(links)) {
                Object.entries(links).forEach(([category, linkList]) => {
                    // Ensure linkList is an array
                    let safeLinks = Array.isArray(linkList) ? linkList : [linkList];

                    let linkItems = safeLinks.map((link, idx) => {
                        const label = getDisplayLabel(collection, link, idx, safeLinks.length);
                        return `<li><a href="${link}" target="_blank">${label}</a></li>`;
                    }).join('');

                    // Group by category (e.g., "GitHub", "web")
                    collectionLinks += `
                        <li class="has-submenu">
                            <span>${category}</span>
                            <ul class="submenu">${linkItems}</ul>
                        </li>`;
                });
            } else {
                // If it's a simple list of links, handle normally
                let safeLinks = Array.isArray(links) ? links : [links];

                collectionLinks = safeLinks.map((link, idx) => {
                    const label = getDisplayLabel(collection, link, idx, safeLinks.length);
                    return `<li><a href="${link}" target="_blank">${label}</a></li>`;
                }).join('');
            }

            etextMenuHtml += `
              <li class="has-submenu">
                <span>${collection}</span>
                <ul class="submenu">${collectionLinks}</ul>
              </li>`;
        });
    }

    // Populate the menu
    menu.html(`
      <ul class="nested-menu">
        <li><strong>${d.type.charAt(0).toUpperCase() + d.type.slice(1)} ID:</strong> ${d.id}</li>
        <li class="has-submenu">
          <span>More info</span>
          <ul class="submenu">
            ${d.aka ? `<li><strong>Aka:</strong> ${d.aka}</li>` : ''}
            ${d.social_ids ? `<li><strong>Social Identifiers:</strong> ${d.social_ids}</li>` : ''}
            ${d.dates ? `<li><strong>Date:</strong> ${d.dates}</li>` : ''}
            ${d.discipline ? `<li><strong>Discipline:</strong> ${d.discipline}</li>` : ''}
            ${d.disciplines ? `<li><strong>Disciplines:</strong> ${d.disciplines}</li>` : ''}
          </ul>
        </li>
        <li class="has-submenu">
          <span>View on</span>
          <ul class="submenu">
            <li><a href="https://www.panditproject.org/node/${d.id}" target="_blank">Pandit</a></li>
            ${etextMenuHtml}
          </ul>
        </li>
        <li class="has-submenu">
          <span>Recenter</span>
          <ul class="submenu">
            <li><button class="recenter-btn" data-hops="1">1 hop</button></li>
            <li><button class="recenter-btn" data-hops="2">2 hops</button></li>
            <li><button class="recenter-btn" data-hops="3">3 hops</button></li>
          </ul>
        </li>
        <li class="has-submenu">
          <span>Exclusions</span>
          <ul class="submenu">
            <li><button id="collapse-btn">Collapse</button></li>
            <!-- <li><button id="remove-btn" disabled>Remove (Not Implemented)</button></li> -->
            <!-- <li><button id="reexpand-btn" disabled>Re-Expand (Not Implemented)</button></li> -->
          </ul>
        </li>
      </ul>
    `);

    // Position and show the menu with viewport awareness
    menu.style('display', 'block')
        .style('left', '0px')
        .style('top', '0px');

    // Get actual dimensions after rendering
    const menuNode = menu.node();
    const menuRect = menuNode.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Calculate position, flipping if needed
    let left = event.pageX;
    let top = event.pageY;

    // Flip horizontally if menu would overflow right edge
    if (left + menuRect.width > scrollX + viewportWidth - 10) {
      left = Math.max(scrollX + 10, left - menuRect.width);
    }

    // Flip vertically if menu would overflow bottom edge
    if (top + menuRect.height > scrollY + viewportHeight - 10) {
      top = Math.max(scrollY + 10, top - menuRect.height);
    }

    menu.style('left', `${left}px`)
        .style('top', `${top}px`);

    // Mark menu position for CSS submenu flip logic
    const menuCenterX = left + menuRect.width / 2;
    const isRightHalf = menuCenterX > scrollX + viewportWidth / 2;
    menu.classed('flip-submenus', isRightHalf);

    // All submenu visibility is now controlled via .submenu-open class (no CSS hover)
    menuNode.querySelectorAll('.has-submenu').forEach(item => {
      const span = item.querySelector(':scope > span');
      const submenu = item.querySelector(':scope > .submenu');
      if (!span || !submenu) return;

      // Mouseenter: open this submenu, close sibling branches
      item.addEventListener('mouseenter', () => {
        // Close sibling submenus and their descendants
        const siblings = item.parentElement.querySelectorAll(':scope > .has-submenu');
        siblings.forEach(sib => {
          if (sib !== item) {
            sib.classList.remove('submenu-open');
            sib.querySelectorAll('.submenu-open').forEach(n => n.classList.remove('submenu-open'));
          }
        });
        // Open this one
        item.classList.add('submenu-open');
        positionSubmenu(submenu, item);
      });

      // Click/tap: toggle (useful for touch devices)
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        item.classList.toggle('submenu-open');
        if (item.classList.contains('submenu-open')) {
          positionSubmenu(submenu, item);
        }
      });
    });

    // Close all submenus when mouse leaves the entire menu (desktop only)
    const isTouch = window.matchMedia('(hover: none)').matches;
    if (!isTouch) {
      menuNode.addEventListener('mouseleave', () => {
        menuNode.querySelectorAll('.submenu-open').forEach(n => n.classList.remove('submenu-open'));
      });
    }

    // Position a submenu to avoid viewport overflow (desktop only - mobile uses accordion CSS)
    function positionSubmenu(submenu, parentLi) {
      // Skip positioning on mobile/touch - CSS handles accordion layout
      const isMobile = window.matchMedia('(max-width: 768px), (hover: none)').matches;
      if (isMobile) return;

      // Reset positioning
      submenu.style.left = '';
      submenu.style.right = '';
      submenu.style.top = '';
      submenu.style.bottom = '';

      const subRect = submenu.getBoundingClientRect();
      const parentRect = parentLi.getBoundingClientRect();

      // Check horizontal overflow
      if (parentRect.right + subRect.width > viewportWidth - 10) {
        // Open to the left instead
        submenu.style.left = 'auto';
        submenu.style.right = '100%';
      }

      // Check vertical overflow
      if (subRect.bottom > viewportHeight - 10) {
        // Align to bottom of parent instead of top
        submenu.style.top = 'auto';
        submenu.style.bottom = '0';
      }
    }

    menu.on('click', async (e) => {
      const target = e.target;

      // Handle link clicks - allow cmd/ctrl-click to open multiple links without closing menu
      if (target.tagName === 'A' && target.href) {
        // If modifier key held, open in background and keep menu open
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          window.open(target.href, '_blank');
          // Brief visual feedback that link was opened
          target.style.opacity = '0.5';
          setTimeout(() => { target.style.opacity = ''; }, 200);
          return;
        }
        // Normal click - let it navigate and menu will close naturally
        return;
      }

      if (target.classList.contains('recenter-btn')) {
        e.stopPropagation(); // Prevent the button click from closing the menu
        const hops = target.getAttribute('data-hops');

        const payload = {
            authors: d.type === 'author' ? [d.id] : [],
            works: d.type === 'work' ? [d.id] : [],
            hops: parseInt(hops, 10),
            exclude_list: [] // Add exclusions if needed
        };

        // Fetch and re-render the graph
        try {
            const response = await fetch('/api/graph/subgraph', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const newGraph = await response.json();
            renderGraph(newGraph.graph);

            // Update dropdowns with the new center only
            const authorsDropdown = $('#authors-dropdown');
            const worksDropdown = $('#works-dropdown');

            await refreshDropdowns(authorsDropdown, worksDropdown);

            const displayText = `${d.label} (${d.id})`; // Include ID in parentheses
            // Redo dropdown for the specific type
            if (d.type === 'author') {
                authorsDropdown.append(new Option(displayText, d.id, true, true)); // Add new center
                authorsDropdown.trigger('change'); // Refresh Select2
            } else if (d.type === 'work') {
                worksDropdown.append(new Option(displayText, d.id, true, true)); // Add new center
                worksDropdown.trigger('change'); // Refresh Select2
            }

            // Update hops input to match the current value
            document.getElementById('hops').value = hops;
        } catch (error) {
            console.error('Error recentering graph:', error);
        }

        // Hide the menu
        menu.style('display', 'none');
      }
      if (target.id === 'collapse-btn') {
        e.stopPropagation(); // Prevent the button click from closing the menu

        // Add the selected node to the exclude list
        const exclude_list = $('#exclude-list-dropdown').val();
        if (!exclude_list.includes(d.id)) {
            exclude_list.push(d.id);
        }

        // Update the dropdown and trigger Select2 change event
        $('#exclude-list-dropdown').val(exclude_list).trigger('change');

        const authors = $('#authors-dropdown').val();
        const works = $('#works-dropdown').val();
        const hops = parseInt(document.getElementById('hops').value, 10);

        const payload = {
            authors: authors,
            works: works,
            hops: hops,
            exclude_list: exclude_list
        };

        // Fetch and re-render the graph
        try {
            const response = await fetch('/api/graph/subgraph', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const updatedGraph = await response.json();
            renderGraph(updatedGraph.graph);
        } catch (error) {
            console.error('Error excluding node:', error);
        }

        // Hide the menu
        menu.style('display', 'none');
      }
    });
  }

  // Hide menu on outside click/tap (but not on modifier-key clicks inside menu)
  d3.select('body').on('click touchstart', (event) => {
    const menu = d3.select('.custom-context-menu');
    const isInsideMenu = event.target.closest('.custom-context-menu');

    if (!isInsideMenu) {
      menu.style('display', 'none');
      menu.selectAll('.submenu-open').classed('submenu-open', false);
    }
  });

  const labels = graphGroup.append('g')
    .selectAll('text')
    .data(graph.nodes)
    .join('text')
    .attr('class', 'label')
    .attr('dy', -15)
    .attr('text-anchor', 'middle')
    .text(d => d.label);

  // Add event listeners to update forces dynamically
  document.getElementById('chargeStrength').addEventListener('input', function () {
      const repulsionStrength = -this.value;
      simulation.force('charge').strength(repulsionStrength);
      simulation.alpha(0.3).restart();
  });

  document.getElementById('linkDistance').addEventListener('input', function () {
      const linkDistance = +this.value;
      simulation.force('link').distance(linkDistance);
      simulation.alpha(0.3).restart();
  });

  document.getElementById('collisionRadius').addEventListener('input', function () {
      const collisionRadius = +this.value;
      simulation.force('collide').radius(collisionRadius);
      simulation.alpha(0.3).restart();
  });


  document.getElementById('freezeSwitch').addEventListener('change', function () {
  if (this.checked) {
    // Freeze: Disable all forces
    simulation
      .force('link', d3.forceLink().strength(0))
      .force('charge', d3.forceManyBody().strength(0))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0))
        .force('collide', d3.forceCollide().strength(0))
        .alpha(0)
        .stop();
    } else {
      // Unfreeze: Reapply forces with current slider values
      const linkDistance = +document.getElementById('linkDistance').value;
      const chargeStrength = -document.getElementById('chargeStrength').value; // Negative for repulsion
      const collisionRadius = +document.getElementById('collisionRadius').value;

      simulation
        .force('link', d3.forceLink(graph.edges).id(d => d.id).distance(linkDistance))
        .force('charge', d3.forceManyBody().strength(chargeStrength))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collide', d3.forceCollide(collisionRadius))
        .alpha(1) // Reset the simulation's energy
        .alphaDecay(0.0228) // Restore default decay
        .restart(); // Restart the simulation
    }
  });

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);

    labels
      .attr('x', d => d.x)
      .attr('y', d => d.y);
  });

  // ResizeObserver: update dimensions and re-center on resize
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      svg.attr('viewBox', `0 0 ${width} ${height}`);
      simulation.force('center', d3.forceCenter(width / 2, height / 2));
      simulation.alpha(0.3).restart();
    }
  });
  resizeObserver.observe(container);
  window._panditya_resizeObserver = resizeObserver;
}
