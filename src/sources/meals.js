import { fetchJson, fetchResponse } from "../http.js";

const MENU_MONTH_OFFSETS = [0, 1];

const sortedEntries = (obj) =>
  Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));

const dedupSort = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b));

const normalizeDayListing = (listing) =>
  Object.fromEntries(
    sortedEntries(listing).map(([section, items]) => [
      section,
      dedupSort(items),
    ]),
  );

// Canonicalize the most common singular/plural mismatch in the source data.
const canonicalizeCategoryName = (value) =>
  value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .replace(/^Special$/, "Specials");

const normalizeItemListing = (listing) =>
  Object.fromEntries(
    sortedEntries(listing).map(([itemName, menus]) => [
      itemName,
      Object.fromEntries(
        sortedEntries(menus).map(([menuName, entry]) => [
          menuName,
          { category: entry.category, days: dedupSort(entry.days) },
        ]),
      ),
    ]),
  );

const parseMenuListing = (setting) => {
  const listing = {};
  let category = "";
  for (const item of JSON.parse(setting).current_display) {
    if (item.type == "category") category = item.name;
    else if (item.type == "recipe")
      (listing[category || "Items"] ??= []).push(item.name);
  }
  return Object.keys(listing).length ? normalizeDayListing(listing) : undefined;
};

const fetchOverwrites = async (url) => {
  const response = await fetchResponse(url);
  if (response.status == 400) {
    console.warn(`Menus: skipping ${url}.`);
    return undefined;
  }
  if (!response.ok) throw new Error(`${url} is ${response.status}ing`);
  return (await response.json()).data;
};

const processOverwrite = (output, menuName, { day, setting }) => {
  const listing = parseMenuListing(setting);
  if (!listing) return;
  for (const [rawCategory, items] of Object.entries(listing)) {
    const category = canonicalizeCategoryName(rawCategory);
    for (const item of items) {
      const entry = ((output[item] ??= {})[menuName] ??= {
        category,
        days: [],
      });
      if (entry.category != category)
        throw new Error(
          `Conflicting categories for ${item} in ${menuName}: ${entry.category} vs ${category}`,
        );
      entry.days.push(day);
    }
  }
};

export const loadMeals = async ({ districtBase, schoolBase }) => {
  const { data: menus } = await fetchJson(`${schoolBase}/menus`);
  const now = new Date();
  const output = {};
  for (const menu of menus) {
    const { id, name: menuName } = menu;
    for (const offset of MENU_MONTH_OFFSETS) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
      );
      const url = `${districtBase}/menus/${id}/year/${d.getUTCFullYear()}/month/${d.getUTCMonth() + 1}/date_overwrites`;

      const overwrites = await fetchOverwrites(url);
      if (!overwrites) continue;
      for (const overwrite of overwrites) {
        processOverwrite(output, menuName, overwrite);
      }
    }
  }
  return normalizeItemListing(output);
};
