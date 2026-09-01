const DATA_URL = "./data/directory.json";
const INITIAL_BATCH_SIZE = 30;
const BATCH_SIZE = 30;
const MAX_VISIBLE_TAGS = 10;

const state = {
  directory: null,
  search: "",
  selectedPrograms: new Set(),
  selectedFields: new Set(),
  selectedLocations: new Set(),
  matching: [],
  visibleCount: INITIAL_BATCH_SIZE
};

const elements = {
  search: document.querySelector("#opportunity-search"),
  clear: document.querySelector("#clear-filters"),
  emptyClear: document.querySelector("#empty-clear"),
  grid: document.querySelector("#opportunity-grid"),
  count: document.querySelector("#results-count"),
  loading: document.querySelector("#loading-state"),
  error: document.querySelector("#error-state"),
  empty: document.querySelector("#empty-state"),
  loadActions: document.querySelector("#load-actions"),
  loadMore: document.querySelector("#load-more"),
  loadAll: document.querySelector("#load-all"),
  locationFilter: document.querySelector("#location-filter"),
  cycleLabel: document.querySelector("#cycle-label"),
  programOverview: document.querySelector("#program-overview"),
  programOverviewLink: document.querySelector("#program-overview-link")
};

initialize();

async function initialize() {
  attachStaticListeners();

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Data request failed with status ${response.status}.`);
    }

    state.directory = await response.json();

    applySettings();
    buildFilters();
    applyFilters();

    elements.loading.hidden = true;
  } catch (error) {
    console.error("Unable to initialize the directory.", error);
    elements.loading.hidden = true;
    elements.error.hidden = false;
    elements.count.textContent = "Opportunities unavailable";
  }
}

function applySettings() {
  const settings = state.directory.settings;

  if (!settings) {
    return;
  }

  if (settings.cycleName) {
    elements.cycleLabel.textContent = settings.cycleName;
    elements.cycleLabel.hidden = false;

    document.title =
      `${settings.cycleName} SPRINT Opportunities | Brown University`;
  }

  if (
    settings.programOverviewLabel &&
    settings.programOverviewUrl
  ) {
    elements.programOverviewLink.textContent =
      settings.programOverviewLabel;
    elements.programOverviewLink.href =
      settings.programOverviewUrl;
    elements.programOverview.hidden = false;
  }
}

function attachStaticListeners() {
  let searchTimer;

  elements.search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);

    searchTimer = window.setTimeout(() => {
      state.search = normalizeText(elements.search.value);
      resetVisibleCount();
      applyFilters();
    }, 150);
  });

  elements.clear.addEventListener("click", clearAll);
  elements.emptyClear.addEventListener("click", clearAll);

  elements.loadMore.addEventListener("click", () => {
    state.visibleCount = Math.min(
      state.visibleCount + BATCH_SIZE,
      state.matching.length
    );

    renderResults({ announce: true });
  });

  elements.loadAll.addEventListener("click", () => {
    state.visibleCount = state.matching.length;
    renderResults({ announce: true });
  });

  document.addEventListener("click", event => {
    const openMenu = document.querySelector(".filter-menu[open]");

    if (openMenu && !openMenu.contains(event.target)) {
      openMenu.removeAttribute("open");
    }

    const trackedLink = event.target.closest("[data-analytics-event]");

    if (trackedLink) {
      document.dispatchEvent(
        new CustomEvent("sprint:analytics", {
          detail: {
            event: trackedLink.dataset.analyticsEvent,
            opportunityId: trackedLink.dataset.opportunityId || null,
            programId: trackedLink.dataset.programId || null
          }
        })
      );
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") {
      return;
    }

    document
      .querySelectorAll(".filter-menu[open]")
      .forEach(menu => menu.removeAttribute("open"));
  });
}

function buildFilters() {
  const { opportunities, programs, taxonomy } = state.directory;

  const usedProgramIds = new Set(
    opportunities.map(opportunity => opportunity.programId)
  );

  const activePrograms = programs
    .filter(program => program.active && usedProgramIds.has(program.id))
    .sort((left, right) =>
      left.filterOrder - right.filterOrder ||
      compareText(left.name, right.name)
    );

  const usedFields = uniqueSorted(
    opportunities.flatMap(opportunity => opportunity.fields)
  );

  const configuredFields = taxonomy
    .filter(item => item.type === "Field" && item.active)
    .map(item => item.value);

  const fields = orderByTaxonomy(usedFields, configuredFields);

  const usedLocations = uniqueSorted(
    opportunities.flatMap(opportunity => opportunity.locations)
  );

  const configuredLocations = taxonomy
    .filter(item => item.type === "Location" && item.active)
    .map(item => item.value);

  const locations = orderByTaxonomy(usedLocations, configuredLocations);

  renderFilterOptions(
    "program",
    activePrograms.map(program => ({
      value: program.id,
      label: program.name
    }))
  );

  renderFilterOptions(
    "field",
    fields.map(field => ({ value: field, label: field }))
  );

  if (locations.length > 0) {
    elements.locationFilter.hidden = false;

    renderFilterOptions(
      "location",
      locations.map(location => ({ value: location, label: location }))
    );
  }
}

function renderFilterOptions(type, options) {
  const container = document.querySelector(
    `[data-filter-options="${type}"]`
  );

  options.forEach((option, index) => {
    const label = document.createElement("label");
    label.className = "filter-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = option.value;
    input.id = `${type}-option-${index}`;

    const text = document.createElement("span");
    text.textContent = option.label;

    input.addEventListener("change", () => {
      const selectedSet = selectedSetForType(type);

      if (input.checked) {
        selectedSet.add(input.value);
      } else {
        selectedSet.delete(input.value);
      }

      updateFilterCount(type);
      resetVisibleCount();
      applyFilters();
    });

    label.append(input, text);
    container.append(label);
  });
}

function selectedSetForType(type) {
  if (type === "program") {
    return state.selectedPrograms;
  }

  if (type === "field") {
    return state.selectedFields;
  }

  return state.selectedLocations;
}

function updateFilterCount(type) {
  const menu = document.querySelector(`#${type}-filter`);
  const count = menu?.querySelector(".filter-count");
  const size = selectedSetForType(type).size;

  if (count) {
    count.textContent = size > 0 ? String(size) : "";
  }
}

function applyFilters() {
  const queryTerms = state.search.split(" ").filter(Boolean);

  state.matching = state.directory.opportunities.filter(opportunity => {
    const matchesSearch = queryTerms.every(term =>
      opportunity.searchText.includes(term)
    );

    const matchesProgram =
      state.selectedPrograms.size === 0 ||
      state.selectedPrograms.has(opportunity.programId);

    const matchesField =
      state.selectedFields.size === 0 ||
      opportunity.fields.some(field => state.selectedFields.has(field));

    const matchesLocation =
      state.selectedLocations.size === 0 ||
      opportunity.locations.some(location =>
        state.selectedLocations.has(location)
      );

    return (
      matchesSearch &&
      matchesProgram &&
      matchesField &&
      matchesLocation
    );
  });

  updateClearButton();
  renderResults();
}

function renderResults({ announce = false } = {}) {
  const total = state.matching.length;
  const visible = state.matching.slice(0, state.visibleCount);

  elements.grid.replaceChildren();

  const fragment = document.createDocumentFragment();

  visible.forEach(opportunity => {
    fragment.append(createOpportunityCard(opportunity));
  });

  elements.grid.append(fragment);

  elements.empty.hidden = total !== 0;
  elements.grid.hidden = total === 0;

  if (total === 0) {
    elements.count.textContent = "No matching opportunities";
  } else if (visible.length < total) {
    elements.count.textContent =
      `Showing ${visible.length} of ${total} opportunities`;
  } else {
    elements.count.textContent =
      `${total} ${total === 1 ? "opportunity" : "opportunities"}`;
  }

  const remaining = total - visible.length;
  elements.loadActions.hidden = remaining <= 0;

  if (remaining > 0) {
    const nextAmount = Math.min(BATCH_SIZE, remaining);
    elements.loadMore.textContent = `Load ${nextAmount} more`;
    elements.loadAll.textContent = `Load all ${remaining} remaining`;
  }

  if (announce) {
    elements.count.setAttribute("role", "status");
  }
}

function createOpportunityCard(opportunity) {
  const program = state.directory.programs.find(
    candidate => candidate.id === opportunity.programId
  );

  const item = document.createElement("li");
  item.className = "opportunity-card";

  const inner = document.createElement("article");
  inner.className = "opportunity-card__inner";
  inner.setAttribute("aria-labelledby", `title-${safeDomId(opportunity.id)}`);

  const header = document.createElement("div");
  header.className = "program-header";
  header.style.setProperty("--program-main", program.mainColor);
  header.style.setProperty(
    "--program-secondary",
    program.secondaryColor || program.mainColor
  );
  header.style.setProperty(
    "--program-text",
    readableTextColor(program.mainColor)
  );

  const programName = document.createElement("span");
  programName.className = "program-name";
  programName.textContent = program.name;

  header.append(programName);

  if (program.url) {
    const programLink = document.createElement("a");
    programLink.className = "program-link";
    programLink.href = program.url;
    programLink.target = "_blank";
    programLink.rel = "noopener noreferrer";
    programLink.textContent = "Program info";
    programLink.setAttribute(
      "aria-label",
      `Learn more about ${program.name}`
    );
    programLink.dataset.analyticsEvent = "program_info_click";
    programLink.dataset.programId = program.id;
    header.append(programLink);
  }

  const body = document.createElement("div");
  body.className = "opportunity-card__body";

  const title = document.createElement("h3");
  title.className = "opportunity-title";
  title.id = `title-${safeDomId(opportunity.id)}`;

  const opportunityLink = document.createElement("a");
  opportunityLink.href = opportunity.url;
  opportunityLink.target = "_blank";
  opportunityLink.rel = "noopener noreferrer";
  opportunityLink.textContent = opportunity.title;
  opportunityLink.dataset.analyticsEvent = "opportunity_click";
  opportunityLink.dataset.opportunityId = opportunity.id;
  opportunityLink.dataset.programId = opportunity.programId;

  title.append(opportunityLink);

  const organization = document.createElement("p");
  organization.className = "organization";
  organization.textContent = opportunity.organization;

  body.append(title, organization);

  if (opportunity.locations.length > 0) {
    const locations = document.createElement("p");
    locations.className = "location-list";
    locations.textContent = `Location: ${opportunity.locations.join(", ")}`;
    body.append(locations);
  }

  const tags = uniqueCaseInsensitive([
    ...opportunity.fields,
    ...opportunity.keywords
  ]);

  if (tags.length > 0) {
    const tagContainer = document.createElement("div");
    tagContainer.className = "tags";
    tagContainer.id = `tags-${safeDomId(opportunity.id)}`;

    tags.forEach((tag, index) => {
      const tagElement = document.createElement("span");
      tagElement.className = "tag";
      tagElement.textContent = tag;

      if (index >= MAX_VISIBLE_TAGS) {
        tagElement.dataset.extraTag = "true";
        tagElement.hidden = true;
      }

      tagContainer.append(tagElement);
    });

    body.append(tagContainer);

    if (tags.length > MAX_VISIBLE_TAGS) {
      const hiddenCount = tags.length - MAX_VISIBLE_TAGS;
      const toggle = document.createElement("button");

      toggle.className = "tag-toggle";
      toggle.type = "button";
      toggle.textContent = `Show ${hiddenCount} more`;
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", tagContainer.id);

      toggle.addEventListener("click", () => {
        const expanded = toggle.getAttribute("aria-expanded") === "true";

        tagContainer
          .querySelectorAll("[data-extra-tag]")
          .forEach(tag => {
            tag.hidden = expanded;
          });

        toggle.setAttribute("aria-expanded", String(!expanded));
        toggle.textContent = expanded
          ? `Show ${hiddenCount} more`
          : "Show fewer";
      });

      body.append(toggle);
    }
  }

  inner.append(header, body);
  item.append(inner);

  return item;
}

function clearAll() {
  state.search = "";
  state.selectedPrograms.clear();
  state.selectedFields.clear();
  state.selectedLocations.clear();
  elements.search.value = "";

  document
    .querySelectorAll('.filter-options input[type="checkbox"]')
    .forEach(input => {
      input.checked = false;
    });

  ["program", "field", "location"].forEach(updateFilterCount);

  document
    .querySelectorAll(".filter-menu[open]")
    .forEach(menu => menu.removeAttribute("open"));

  resetVisibleCount();
  applyFilters();
  elements.search.focus();
}

function updateClearButton() {
  const hasFilters =
    state.search.length > 0 ||
    state.selectedPrograms.size > 0 ||
    state.selectedFields.size > 0 ||
    state.selectedLocations.size > 0;

  elements.clear.disabled = !hasFilters;
}

function resetVisibleCount() {
  state.visibleCount = INITIAL_BATCH_SIZE;
}

function orderByTaxonomy(usedValues, configuredValues) {
  const usedMap = new Map(
    usedValues.map(value => [normalizeText(value), value])
  );

  const configured = configuredValues.filter(value =>
    usedMap.has(normalizeText(value))
  );

  const configuredKeys = new Set(configured.map(normalizeText));

  const unconfigured = usedValues.filter(
    value => !configuredKeys.has(normalizeText(value))
  );

  return [...configured, ...unconfigured];
}

function uniqueSorted(values) {
  return uniqueCaseInsensitive(values).sort(compareText);
}

function uniqueCaseInsensitive(values) {
  const seen = new Set();

  return values.filter(value => {
    const key = normalizeText(value);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function compareText(left, right) {
  return left.localeCompare(right, "en", {
    sensitivity: "base",
    numeric: true
  });
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDomId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function readableTextColor(hexColor) {
  const color = String(hexColor).replace("#", "");

  if (!/^[0-9a-f]{6}$/i.test(color)) {
    return "#ffffff";
  }

  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);

  const luminance =
    (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  return luminance > 0.58 ? "#1b1b1b" : "#ffffff";
}
