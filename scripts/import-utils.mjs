export function clean(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalize(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US");
}

export function splitList(value) {
  const seen = new Set();
  const result = [];

  for (const item of String(value ?? "").split(",")) {
    const cleaned = clean(item);
    const key = normalize(cleaned);

    if (cleaned && !seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }

  return result;
}

export function parseBoolean(value) {
  return ["true", "yes", "1", "y"].includes(normalize(value));
}

export function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(clean(value));
}

export function createSearchText(opportunity, programName) {
  return normalize([
    opportunity.organization,
    opportunity.title,
    programName,
    ...opportunity.fields,
    ...opportunity.keywords,
    ...opportunity.locations
  ].join(" "));
}
