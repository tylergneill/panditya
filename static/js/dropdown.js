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

    // Remove pre-initialization class
    document.querySelectorAll('.select2-initial').forEach(el => el.classList.remove('select2-initial'));

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
}
