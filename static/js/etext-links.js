/**
 * Turning a work's SETI e-text links into short, readable link labels.
 *
 * The rules are the ones the old right-click menu used (moved here unchanged
 * so they can be tested on their own, tests/js/etext-links.test.mjs). A node's
 * `etext_links` looks like either
 *
 *   {"GRETIL": ["https://.../sa_kAlidAsa-kumArasaMbhava.htm"], ...}
 * or, for collections with several kinds of link,
 *   {"DCS": {"GitHub": [...], "web": [...]}, ...}
 */

/** The last path or query segment of a URL, without its file extension. */
export function basename(url) {
  if (typeof url !== 'string') return '';
  return url.split(/[/=]/).pop().replace(/\.[^.]+$/, '');
}

/**
 * Per-collection label rules. Each takes (link, collection, index, total) and
 * returns a label; collections without a rule fall back to `basename`.
 */
export const LABEL_EXTRACTORS = {
  GRETIL: link => basename(link),

  // DCS has three link shapes, but all yield a short ID or title we can grab.
  DCS: link => {
    // "index.php?…IDTextDisplay=165" -> 165
    const m = link.match(/IDTextDisplay=(\d+)/);
    if (m) return m[1];
    // GitHub raw/tree path ".../files/SomeTitle", or ".../extracted/SomeTitle.txt" -> SomeTitle
    return basename(link);
  },

  SARIT: link => basename(link),

  'Sanskrit Library and TITUS': link => basename(link),

  'Vātāyana and Pramāṇa NLP': link => {
    const m = link.match(/text_abbrv=([^&]+)/); // HBṬ
    return m ? safeDecode(m[1]) : basename(link);
  },

  'Muktabodha KSTS': link => {
    const m = link.match(/miri_catalog_number=([^&]+)/); // M00349
    return m ? m[1] : basename(link);
  },

  'UTA Dharmaśāstra': (link, _collection, idx, total) => {
    // Google Docs links -> "Google Doc", numbered if there are several
    if (link.includes('docs.google.com/document')) {
      return total > 1 ? `Google Doc ${idx + 1}` : 'Google Doc';
    }
    // UT Austin "sites" links -> everything after ".../resources/", no trailing slash
    const m = link.match(/\/resources\/([^?#]+?)(\/)?$/);
    if (m) return safeDecode(m[1]);
    return basename(link);
  },

  'DiPAL DCV': link => {
    // Prefer tra_id (a translated text), then wor_id (a work-level page).
    let m = link.match(/tra_id=(\d+)/);
    if (m) return m[1];
    m = link.match(/wor_id=(\d+)/);
    if (m) return m[1];
    return basename(link);
  },
};

/** decodeURIComponent that returns its input instead of throwing on bad escapes. */
function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The label for one link of `collection` (its idx-th of `total`). */
export function displayLabel(collection, link, idx = 0, total = 1) {
  const extractor = LABEL_EXTRACTORS[collection];
  const label = extractor ? extractor(link, collection, idx, total) : basename(link);
  return label || link;
}

/** Only http(s) links are ever turned into clickable links. */
export function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Flatten a node's `etext_links` into a list the details panel can render:
 *
 *   [{collection, groups: [{category: string|null, links: [{href, label}]}]}]
 *
 * Unsafe or malformed links are skipped; collections left with no links are dropped.
 */
export function groupEtextLinks(etextLinks) {
  if (!etextLinks || typeof etextLinks !== 'object') return [];
  const asList = value => (Array.isArray(value) ? value : [value]);
  const toLinks = (collection, list) => {
    const safe = asList(list).filter(link => typeof link === 'string' && isSafeUrl(link));
    return safe.map((href, idx) => ({ href, label: displayLabel(collection, href, idx, safe.length) }));
  };

  const result = [];
  for (const [collection, value] of Object.entries(etextLinks)) {
    const groups = (value && typeof value === 'object' && !Array.isArray(value))
      ? Object.entries(value).map(([category, list]) => ({ category, links: toLinks(collection, list) }))
      : [{ category: null, links: toLinks(collection, value) }];
    const nonEmpty = groups.filter(g => g.links.length);
    if (nonEmpty.length) result.push({ collection, groups: nonEmpty });
  }
  return result;
}
