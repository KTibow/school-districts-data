import { fetchJson, fetchResponse } from "../http.js";

const MENU_MONTH_OFFSETS = [0, 1];

const sortObject = (value) =>
  Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );

const normalizeMenuListing = (listing) =>
  Object.fromEntries(
    Object.entries(sortObject(listing)).map(([section, items]) => [
      section,
      [...new Set(items)].sort((a, b) => a.localeCompare(b)),
    ]),
  );

const getMenuMonths = () => {
  const current = new Date();
  current.setUTCDate(1);

  return MENU_MONTH_OFFSETS.map((offset) => {
    const date = new Date(current);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
    };
  });
};

const parseMenuListing = (setting) => {
  const currentDisplay = JSON.parse(setting).current_display;

  const listing = {};
  let category = "";

  for (const item of currentDisplay) {
    if (item.type == "category") {
      category = item.name;
      continue;
    }

    if (item.type != "recipe") {
      continue;
    }

    const section = category || "Items";
    (listing[section] ??= []).push(item.name);
  }

  return Object.keys(listing).length
    ? normalizeMenuListing(listing)
    : undefined;
};

export const loadMenus = async ({ districtBase, schoolBase }) => {
  const { data: menus } = await fetchJson(`${schoolBase}/menus`);
  const output = {};

  for (const { id, name } of menus) {
    const menuName = name;
    const menuDays = {};

    for (const { year, month } of getMenuMonths()) {
      const url = `${districtBase}/menus/${id}/year/${year}/month/${month}/date_overwrites`;
      const response = await fetchResponse(url);
      if (response.status == 400) {
        console.warn(`Menus: skipping ${year}/${month} for ${url}.`);
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `${response.status} ${response.statusText} from ${url}`,
        );
      }

      const { data: overwrites } = JSON.parse(await response.text());
      for (const { day, setting } of overwrites) {
        const listing = parseMenuListing(setting);
        menuDays[day] = listing;
      }
    }

    if (Object.keys(menuDays).length) {
      output[menuName] = sortObject(menuDays);
    }
  }

  return sortObject(output);
};
