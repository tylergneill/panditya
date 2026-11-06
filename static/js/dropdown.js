export async function refreshDropdowns(authorsDropdown, worksDropdown) {
    try {
        const [authorsRes, worksRes] = await Promise.all([
            fetch('/api/entities/authors'),
            fetch('/api/entities/works')
        ]);

        const [optionsAuthors, optionsWorks] = await Promise.all([
            authorsRes.json(),
            worksRes.json()
        ]);

        authorsDropdown.empty();
        worksDropdown.empty();

        optionsAuthors.forEach(({ id, label }) => {
            authorsDropdown.append(new Option(label, id));
        });

        optionsWorks.forEach(({ id, label }) => {
            worksDropdown.append(new Option(label, id));
        });

        authorsDropdown.trigger('change');
        worksDropdown.trigger('change');
    } catch (error) {
        console.error('Error refreshing dropdowns:', error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Fetch data for dropdowns
    const [authorsRes, worksRes] = await Promise.all([
      fetch('/api/entities/authors'),
      fetch('/api/entities/works')
    ]);

    const [optionsAuthors, optionsWorks] = await Promise.all([
      authorsRes.json(),
      worksRes.json()
    ]);

    // Get elements
    const authorsDropdown = document.getElementById('authors-dropdown');
    const worksDropdown = document.getElementById('works-dropdown');
    const excludeDropdown = document.getElementById('exclude-list-dropdown');

    // Populate dropdowns
    populateDropdown(authorsDropdown, optionsAuthors);
    populateDropdown(worksDropdown, optionsWorks);
    populateDropdown(excludeDropdown, [...optionsAuthors, ...optionsWorks]);

    // Initialize Select2
    initializeSelect2('#authors-dropdown', 'Authors to include');
    initializeSelect2('#works-dropdown', 'Works to include');
    initializeSelect2('#exclude-list-dropdown', 'Entities to not expand');

    // Remove pre-initialization class and reveal sidebar content
    document.querySelectorAll('.select2-initial').forEach(el => el.classList.remove('select2-initial'));
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('loading');

  } catch (error) {
    console.error('Error during initialization:', error);
  }
});

// Populate dropdown options
function populateDropdown(dropdown, options) {
  options.forEach(({ id, label }) => {
    const option = new Option(label, id);
    dropdown.add(option);
  });
}

// Initialize Select2 with placeholder
function initializeSelect2(selector, placeholder) {
  $(selector).select2({
    placeholder: placeholder,
    allowClear: true,
    tags: false,
    width: '100%'
  });
  // Keep password managers (1Password, LastPass, Bitwarden) off the search box.
  // Select2 creates this input once at init and reuses it, so tagging it here sticks.
  $(selector).next('.select2-container').find('.select2-search__field').attr({
    'autocomplete': 'off',
    'data-1p-ignore': '',
    'data-lpignore': 'true',
    'data-bwignore': ''
  });

  // The sidebar caps the selection box's height (style.css), so it scrolls once
  // it fills up. When an entry is added (typed, or from a graph node in graph.js,
  // which only triggers 'change') or the box is opened, scroll it to the bottom so
  // the inline search field after the last chip stays visible. Removing a chip
  // leaves the scroll position alone.
  const $selection = $(selector).next('.select2-container').find('.select2-selection--multiple');
  const scrollToSearch = () => $selection.scrollTop($selection[0].scrollHeight);
  let selectedCount = ($(selector).val() || []).length;
  $(selector).on('change', function () {
    const count = ($(this).val() || []).length;
    if (count > selectedCount) scrollToSearch();
    selectedCount = count;
  });
  $(selector).on('select2:open', scrollToSearch);
  // A preloaded page (graph.js) may fill the box before this runs, which the
  // 'change' handler above misses, so start at the bottom here too.
  scrollToSearch();
}
