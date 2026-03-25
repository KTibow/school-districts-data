import { fetchJson, fetchResponse } from "../http.js";

const MENU_MONTH_OFFSETS = [0, 1];

const sortedEntries = (obj) =>
  Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));

const dedupSort = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b));

const normalizeMeal = (name) => name.trim();

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

export const filterMeals = (listing, school) =>
  Object.fromEntries(
    sortedEntries(listing)
      .map(([itemName, menus]) => [
        itemName,
        Object.fromEntries(
          sortedEntries(menus)
            .filter(([, entry]) => entry.schoolNames.includes(school))
            .map(([menuName, entry]) => [
              menuName,
              { category: entry.category, days: entry.days },
            ]),
        ),
      ])
      .filter(([, menus]) => Object.keys(menus).length),
  );

const parseMenuListing = (setting) => {
  const listing = {};
  let category = "";
  for (const item of JSON.parse(setting).current_display) {
    if (item.type == "category") category = item.name;
    else if (item.type == "recipe")
      (listing[category || "Items"] ??= []).push(normalizeMeal(item.name));
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

const REQUEST_PAUSE = 250;
export const loadMeals = async (districtBase, schoolBases) => {
  const menusById = new Map();
  for (const [school, schoolBase] of sortedEntries(schoolBases)) {
    await new Promise((r) => setTimeout(r, REQUEST_PAUSE));
    const { data: menus } = await fetchJson(`${schoolBase}/menus`);
    for (const { id, name } of menus) {
      const menu = menusById.get(id) ?? { id, name, schoolNames: [] };
      if (menu.name != name)
        throw new Error(
          `Conflicting menu names for menu ${id}: ${menu.name} vs ${name}`,
        );
      menu.schoolNames.push(school);
      menusById.set(id, menu);
    }
  }

  const now = new Date();
  const aggregate = {};
  for (const menu of menusById.values()) {
    for (const offset of MENU_MONTH_OFFSETS) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1),
      );
      const url = `${districtBase}/menus/${menu.id}/year/${d.getUTCFullYear()}/month/${d.getUTCMonth() + 1}/date_overwrites`;
      await new Promise((r) => setTimeout(r, REQUEST_PAUSE));
      const overwrites = await fetchOverwrites(url);
      if (!overwrites) continue;
      for (const { day, setting } of overwrites) {
        const listing = parseMenuListing(setting);
        if (!listing) continue;
        for (const [rawCategory, items] of Object.entries(listing)) {
          const category = canonicalizeCategoryName(rawCategory);
          for (const item of items) {
            const entry = ((aggregate[item] ??= {})[menu.name] ??= {
              schoolNames: new Set(),
              category,
              days: new Set(),
            });
            if (entry.category != category)
              throw new Error(
                `Conflicting categories for ${item} in ${menu.name} (menu ${menu.id}): ${entry.category} vs ${category}`,
              );
            for (const s of menu.schoolNames) entry.schoolNames.add(s);
            entry.days.add(day);
          }
        }
      }
    }
  }

  return Object.fromEntries(
    sortedEntries(aggregate).map(([itemName, menus]) => [
      itemName,
      Object.fromEntries(
        sortedEntries(menus).map(([menuName, entry]) => [
          menuName,
          {
            schoolNames: dedupSort([...entry.schoolNames]),
            category: entry.category,
            days: dedupSort([...entry.days]),
          },
        ]),
      ),
    ]),
  );
};
