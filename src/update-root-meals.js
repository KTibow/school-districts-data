import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { districtApps, schoolApps } from "school-districts";
import { fetchJson, fetchResponse } from "./http.js";

const MENU_MONTH_OFFSETS = [0, 1];
const REQUEST_PAUSE = 250;

const DATA_DIR = path.join(process.cwd(), "data");
const ROOT_MEALS_DIR = path.join(DATA_DIR, "+meals");

const sortedEntries = (obj) =>
  Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));

const dedupSort = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b));

const sanitizePathSegment = (value) => value.replaceAll("/", " - ");

const normalizeMeal = (name) => name.trim();

const isAllWithText = (item) =>
  item.type == "text" &&
  /^all\s+(served|offered)\s+with$/i.test(item.name.trim());

const normalizeDayListing = (listing) =>
  Object.fromEntries(
    sortedEntries(listing).map(([section, items]) => [
      section,
      dedupSort(items),
    ]),
  );

const writeJson = async (filePath, data) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

const getAppBase = (apps, appName) =>
  apps.find((app) => app.app === appName).base;

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

const parseMenuListing = (setting) => {
  const listing = {};
  let category = "";
  let categoryRecipes = [];
  let allWithRecipes = [];
  let pendingAllWith = false;

  const currentSection = () => category || "Items";
  const flushCategoryRecipes = () => {
    const suffix = allWithRecipes.length
      ? ` with ${allWithRecipes.map((item) => normalizeMeal(item)).join(" and ")}`
      : "";
    for (const recipe of categoryRecipes)
      (listing[currentSection()] ??= []).push(normalizeMeal(recipe) + suffix);
    categoryRecipes = [];
    allWithRecipes = [];
    pendingAllWith = false;
  };

  for (const item of JSON.parse(setting).current_display) {
    if (item.type == "category") {
      flushCategoryRecipes();
      category = item.name;
      continue;
    }

    if (item.type != "recipe" && item.type != "text") continue;

    if (item.type != "recipe") {
      if (isAllWithText(item)) {
        pendingAllWith = true;
      }
      continue;
    }

    if (pendingAllWith) {
      allWithRecipes.push(item.name);
      continue;
    }

    categoryRecipes.push(item.name);
  }

  flushCategoryRecipes();
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

const loadMeals = async (districtBase, schoolBases) => {
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

for (const [domain, appsBySchool] of sortedEntries(schoolApps)) {
  const domainMeals = await loadMeals(
    getAppBase(districtApps[domain], "My School Menus"),
    Object.fromEntries(
      sortedEntries(appsBySchool).map(([school, apps]) => [
        school,
        getAppBase(apps, "My School Menus"),
      ]),
    ),
  );

  const filePath = path.join(ROOT_MEALS_DIR, `${sanitizePathSegment(domain)}.json`);
  await writeJson(filePath, domainMeals);
  console.log(
    `Wrote root meals for ${domain} (${Object.keys(domainMeals).length} items) to ${filePath}`,
  );
}
