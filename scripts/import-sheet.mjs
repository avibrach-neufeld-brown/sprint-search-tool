import fs from "node:fs/promises";
import process from "node:process";
import { parse } from "csv-parse/sync";

import {
  clean,
  normalize,
  splitList,
  parseBoolean,
  isHttpsUrl,
  isHexColor,
  createSearchText
} from "./import-utils.mjs";

const SHEET_ID = "1ks63ew54RtEUyghnSu4DJIZTxqrikgkldc32qbmToyo";

const urls = {
  opportunities: sheetCsvUrl("Opportunities"),
  programs: sheetCsvUrl("Programs"),
  taxonomy: sheetCsvUrl("Taxonomy"),
  settings: sheetCsvUrl("Settings")
};

const errors = [];
const warnings = [];

try {
  const [
    opportunityRows,
    programRows,
    taxonomyRows,
    settingsRows
  ] = await Promise.all([
    fetchSheet(urls.opportunities, "Opportunities"),
    fetchSheet(urls.programs, "Programs"),
    fetchSheet(urls.taxonomy, "Taxonomy"),
    fetchSheet(urls.settings, "Settings")
  ]);

  requireHeaders("Opportunities", opportunityRows, [
    "ID",
    "Published",
    "Organization",
    "Position/Project",
    "Program ID",
    "Link",
    "Field/Industry",
    "Keywords",
    "Location",
    "Last Updated"
  ]);

  requireHeaders("Programs", programRows, [
    "Program ID",
    "Program Name",
    "Main Color",
    "Secondary Color",
    "Program Link",
    "Active",
    "Filter Order"
  ]);

  requireHeaders("Taxonomy", taxonomyRows, [
    "Type",
    "Value",
    "Active",
    "Display Order"
  ]);

  requireHeaders("Settings", settingsRows, [
    "Key",
    "Value"
  ]);

  const programs = parsePrograms(programRows);
  const programMap = new Map(programs.map(program => [program.id, program]));
  const taxonomy = parseTaxonomy(taxonomyRows);
  const settings = parseSettings(settingsRows);
  const opportunities = parseOpportunities(opportunityRows, programMap);

  validateTaxonomy(opportunities, taxonomy);
  validateProgramUsage(opportunities, programs);

  const output = {
    generatedAt: new Date().toISOString(),
    source: "SPRINT Opportunity Directory Source",
    opportunityCount: opportunities.length,
    settings,
    opportunities,
    programs,
    taxonomy
  };

  await fs.mkdir("data", { recursive: true });
  await writeReport();

  if (errors.length > 0) {
    printSummary(opportunities.length);
    process.exitCode = 1;
  } else {
    await fs.writeFile(
      "data/directory.json",
      `${JSON.stringify(output, null, 2)}\n`,
      "utf8"
    );

    printSummary(opportunities.length);
  }
} catch (error) {
  errors.push({
    sheet: "Import",
    row: null,
    field: null,
    message: error.message
  });

  await fs.mkdir("data", { recursive: true });
  await writeReport();
  printSummary(0);
  process.exitCode = 1;
}

function sheetCsvUrl(sheetName) {
  return (
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
  );
}

async function fetchSheet(url, sheetName) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Brown-SPRINT-Directory-Publisher/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `${sheetName} could not be downloaded: HTTP ${response.status}.`
    );
  }

  const body = await response.text();

  if (!body.trim()) {
    throw new Error(`${sheetName} returned no data.`);
  }

  const rows = parse(body, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
    trim: false
  });

  if (!Array.isArray(rows)) {
    throw new Error(`${sheetName} did not produce a valid row set.`);
  }

  return rows;
}

function requireHeaders(sheetName, rows, requiredHeaders) {
  if (rows.length === 0) {
    errors.push({
      sheet: sheetName,
      row: 1,
      field: null,
      message: "The sheet contains no data rows."
    });

    return;
  }

  const headers = Object.keys(rows[0]);

  for (const required of requiredHeaders) {
    if (!headers.includes(required)) {
      errors.push({
        sheet: sheetName,
        row: 1,
        field: required,
        message: `Required column "${required}" is missing.`
      });
    }
  }
}

function parseSettings(rows) {
  const values = new Map();
  const supportedKeys = new Set([
    "cycle_name",
    "program_overview_label",
    "program_overview_url"
  ]);

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const key = clean(row.Key);
    const value = clean(row.Value);

    if (!key && !value) {
      return;
    }

    if (!key) {
      addError(
        "Settings",
        rowNumber,
        "Key",
        "A setting key is required."
      );
      return;
    }

    if (values.has(key)) {
      addError(
        "Settings",
        rowNumber,
        "Key",
        `Duplicate setting key "${key}".`
      );
      return;
    }

    if (!supportedKeys.has(key)) {
      addWarning(
        "Settings",
        rowNumber,
        "Key",
        `Unrecognized setting key "${key}".`
      );
    }

    values.set(key, value);
  });

  for (const requiredKey of supportedKeys) {
    if (!values.get(requiredKey)) {
      addError(
        "Settings",
        null,
        "Value",
        `Required setting "${requiredKey}" is missing or blank.`
      );
    }
  }

  const programOverviewUrl =
    values.get("program_overview_url") || "";

  if (
    programOverviewUrl &&
    !isHttpsUrl(programOverviewUrl)
  ) {
    addError(
      "Settings",
      null,
      "Value",
      "The program_overview_url setting must use HTTPS."
    );
  }

  return {
    cycleName: values.get("cycle_name") || "",
    programOverviewLabel:
      values.get("program_overview_label") || "",
    programOverviewUrl
  };
}

function parsePrograms(rows) {
  const programs = [];
  const ids = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const id = clean(row["Program ID"]);
    const name = clean(row["Program Name"]);
    const mainColor = clean(row["Main Color"]).toUpperCase();
    const secondaryColor =
      clean(row["Secondary Color"]).toUpperCase() || mainColor;
    const url = clean(row["Program Link"]);
    const active = parseBoolean(row.Active);
    const filterOrder =
      Number.parseInt(clean(row["Filter Order"]), 10) || 9999;

    if (!id && !name) {
      return;
    }

    requiredValue("Programs", rowNumber, "Program ID", id);
    requiredValue("Programs", rowNumber, "Program Name", name);

    if (ids.has(id)) {
      addError(
        "Programs",
        rowNumber,
        "Program ID",
        `Duplicate Program ID "${id}".`
      );
    }

    ids.add(id);

    if (!isHexColor(mainColor)) {
      addError(
        "Programs",
        rowNumber,
        "Main Color",
        `Expected a six-digit hex color; received "${mainColor}".`
      );
    }

    if (!isHexColor(secondaryColor)) {
      addError(
        "Programs",
        rowNumber,
        "Secondary Color",
        `Expected a six-digit hex color; received "${secondaryColor}".`
      );
    }

    if (url && !isHttpsUrl(url)) {
      addError(
        "Programs",
        rowNumber,
        "Program Link",
        "Program links must use HTTPS."
      );
    }

    programs.push({
      id,
      name,
      mainColor,
      secondaryColor,
      url,
      active,
      filterOrder
    });
  });

  if (programs.length === 0) {
    addError("Programs", null, null, "No programs were found.");
  }

  return programs;
}

function parseTaxonomy(rows) {
  const taxonomy = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const type = clean(row.Type);
    const value = clean(row.Value);

    if (!type && !value) {
      return;
    }

    if (!["Field", "Location"].includes(type)) {
      addWarning(
        "Taxonomy",
        rowNumber,
        "Type",
        `Unrecognized taxonomy type "${type}".`
      );
    }

    if (!value) {
      addWarning(
        "Taxonomy",
        rowNumber,
        "Value",
        "Taxonomy rows should have a value."
      );

      return;
    }

    taxonomy.push({
      type,
      value,
      active: parseBoolean(row.Active),
      displayOrder:
        Number.parseInt(clean(row["Display Order"]), 10) || 9999
    });
  });

  taxonomy.sort(
    (left, right) =>
      left.displayOrder - right.displayOrder ||
      left.value.localeCompare(right.value, "en", {
        sensitivity: "base",
        numeric: true
      })
  );

  return taxonomy;
}

function parseOpportunities(rows, programMap) {
  const opportunities = [];
  const ids = new Set();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    if (!parseBoolean(row.Published)) {
      return;
    }

    const id = clean(row.ID);
    const organization = clean(row.Organization);
    const title = clean(row["Position/Project"]);
    const programId = clean(row["Program ID"]);
    const url = clean(row.Link);
    const fields = splitList(row["Field/Industry"]);
    const keywords = splitList(row.Keywords);
    const locations = splitList(row.Location);
    const lastUpdated = clean(row["Last Updated"]);

    requiredValue("Opportunities", rowNumber, "ID", id);
    requiredValue(
      "Opportunities",
      rowNumber,
      "Organization",
      organization
    );
    requiredValue(
      "Opportunities",
      rowNumber,
      "Position/Project",
      title
    );
    requiredValue(
      "Opportunities",
      rowNumber,
      "Program ID",
      programId
    );
    requiredValue("Opportunities", rowNumber, "Link", url);

    if (id && ids.has(id)) {
      addError(
        "Opportunities",
        rowNumber,
        "ID",
        `Duplicate opportunity ID "${id}".`
      );
    }

    ids.add(id);

    if (url && !isHttpsUrl(url)) {
      addError(
        "Opportunities",
        rowNumber,
        "Link",
        "Opportunity links must use HTTPS."
      );
    }

    const program = programMap.get(programId);

    if (programId && !program) {
      addError(
        "Opportunities",
        rowNumber,
        "Program ID",
        `Unknown Program ID "${programId}".`
      );
    } else if (program && !program.active) {
      addWarning(
        "Opportunities",
        rowNumber,
        "Program ID",
        `Opportunity uses inactive program "${program.name}".`
      );
    }

    if (fields.length === 0 && keywords.length === 0) {
      addWarning(
        "Opportunities",
        rowNumber,
        "Field/Industry",
        "Opportunity has no fields or keywords."
      );
    }

    const opportunity = {
      id,
      organization,
      title,
      programId,
      url,
      fields,
      keywords,
      locations,
      lastUpdated
    };

    opportunity.searchText = createSearchText(
      opportunity,
      program?.name || ""
    );

    opportunities.push(opportunity);
  });

  if (opportunities.length === 0) {
    addError(
      "Opportunities",
      null,
      null,
      "No published opportunities were found."
    );
  }

  return opportunities;
}

function validateTaxonomy(opportunities, taxonomy) {
  const activeFields = new Set(
    taxonomy
      .filter(item => item.type === "Field" && item.active)
      .map(item => normalize(item.value))
  );

  const activeLocations = new Set(
    taxonomy
      .filter(item => item.type === "Location" && item.active)
      .map(item => normalize(item.value))
  );

  const unknownFields = new Set();
  const unknownLocations = new Set();

  for (const opportunity of opportunities) {
    for (const field of opportunity.fields) {
      if (activeFields.size > 0 && !activeFields.has(normalize(field))) {
        unknownFields.add(field);
      }
    }

    for (const location of opportunity.locations) {
      if (
        activeLocations.size > 0 &&
        !activeLocations.has(normalize(location))
      ) {
        unknownLocations.add(location);
      }
    }
  }

  for (const field of unknownFields) {
    addWarning(
      "Opportunities",
      null,
      "Field/Industry",
      `Field is not in the active taxonomy: "${field}".`
    );
  }

  for (const location of unknownLocations) {
    addWarning(
      "Opportunities",
      null,
      "Location",
      `Location is not in the active taxonomy: "${location}".`
    );
  }
}

function validateProgramUsage(opportunities, programs) {
  const usedProgramIds = new Set(
    opportunities.map(opportunity => opportunity.programId)
  );

  for (const program of programs) {
    if (program.active && !usedProgramIds.has(program.id)) {
      addWarning(
        "Programs",
        null,
        "Program ID",
        `Active program "${program.name}" has no published opportunities.`
      );
    }
  }
}

function requiredValue(sheet, row, field, value) {
  if (!value) {
    addError(sheet, row, field, "A value is required.");
  }
}

function addError(sheet, row, field, message) {
  errors.push({ sheet, row, field, message });
}

function addWarning(sheet, row, field, message) {
  warnings.push({ sheet, row, field, message });
}

async function writeReport() {
  const lines = [
    "# SPRINT directory publication report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `- Errors: ${errors.length}`,
    `- Warnings: ${warnings.length}`,
    ""
  ];

  if (errors.length > 0) {
    lines.push("## Errors", "");

    errors.forEach(item => {
      lines.push(`- ${formatIssue(item)}`);
    });

    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push("## Warnings", "");

    warnings.forEach(item => {
      lines.push(`- ${formatIssue(item)}`);
    });

    lines.push("");
  }

  if (errors.length === 0 && warnings.length === 0) {
    lines.push("No errors or warnings were found.", "");
  }

  await fs.writeFile(
    "data/publication-report.md",
    `${lines.join("\n")}\n`,
    "utf8"
  );

  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `${lines.join("\n")}\n`,
      "utf8"
    );
  }
}

function formatIssue(item) {
  const location = [
    item.sheet,
    item.row ? `row ${item.row}` : null,
    item.field || null
  ].filter(Boolean).join(" — ");

  return `**${location}:** ${item.message}`;
}

function printSummary(opportunityCount) {
  console.log("");
  console.log("SPRINT directory import");
  console.log(`Published opportunities: ${opportunityCount}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);

  errors.forEach(item => {
    console.error(`ERROR: ${formatIssue(item)}`);
  });

  warnings.forEach(item => {
    console.warn(`WARNING: ${formatIssue(item)}`);
  });
}
