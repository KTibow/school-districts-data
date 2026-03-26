import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { districtApps, districtNews, schoolApps } from "school-districts";
import { loadDistrictAlerts } from "./sources/flashalert.js";
import { loadSubs } from "./sources/subs.js";
import { loadWeather } from "./sources/weather.js";

const DATA_DIR = path.join(process.cwd(), "data");
const ROOT_IMAGES_DIR = path.join(DATA_DIR, "+images");
const ROOT_MEALS_DIR = path.join(DATA_DIR, "+meals");

const sortedEntries = (obj) =>
  Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));

const sanitizePathSegment = (value) => value.replaceAll("/", " - ");

const writeJson = async (filePath, data) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

const getAppBase = (apps, appName) =>
  apps.find((app) => app.app === appName).base;

const listImageFiles = async () => {
  try {
    return (await readdir(ROOT_IMAGES_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};

const indexImageFilesByMeal = (imageFiles) => {
  const imageFilesByMeal = new Map();

  for (const imageFile of imageFiles) {
    const mealName = path.parse(imageFile).name;
    const matches = imageFilesByMeal.get(mealName) ?? [];
    matches.push(imageFile);
    imageFilesByMeal.set(mealName, matches);
  }

  return imageFilesByMeal;
};

const buildMealsForSchool = (listing, school, imageFilesByMeal, usedImageFiles) => {
  const meals = {};

  for (const [mealName, menus] of sortedEntries(listing)) {
    const matchingImageFiles = imageFilesByMeal.get(mealName) ?? [];
    const hasImage = matchingImageFiles.length > 0;
    let schoolMenus = null;

    for (const [menuName, entry] of sortedEntries(menus)) {
      if (!entry.schoolNames.includes(school)) continue;

      schoolMenus ??= {};
      schoolMenus[menuName] = {
        category: entry.category,
        days: entry.days,
        servedWith: entry.servedWith,
        hasImage,
      };
    }

    if (schoolMenus == null) continue;

    for (const imageFile of matchingImageFiles) usedImageFiles.add(imageFile);
    meals[mealName] = schoolMenus;
  }

  return meals;
};

const updateDistrict = async (domain) => {
  const districtFile = path.join(
    DATA_DIR,
    "districts",
    `${sanitizePathSegment(domain)}.json`,
  );
  const news = districtNews[domain];

  const alerts =
    news.type === "flashalert" ? await loadDistrictAlerts(news) : [];

  await writeJson(districtFile, {
    alerts,
  });

  console.log(`Wrote district data for ${domain} (${alerts.length} alerts)`);
};

const updateSchool = async (
  domain,
  school,
  forecastBase,
  weatherByGridpoint,
  allMeals,
  imageFilesByMeal,
  usedImageFiles,
) => {
  const schoolFile = path.join(
    DATA_DIR,
    "schools",
    sanitizePathSegment(domain),
    `${sanitizePathSegment(school)}.json`,
  );

  const synergyBase = getAppBase(districtApps[domain], "Synergy");
  const weather = weatherByGridpoint[forecastBase];
  if (weather == undefined)
    throw new Error(`Missing weather for ${school} (${forecastBase})`);

  const subs = await loadSubs({ synergyBase, school });
  const meals = buildMealsForSchool(
    allMeals,
    school,
    imageFilesByMeal,
    usedImageFiles,
  );

  await writeJson(schoolFile, {
    weather,
    meals,
    subs,
  });

  console.log(
    `Wrote school data for ${domain}/${school} (${Object.keys(weather).length} weather, ${Object.keys(meals).length} meals, ${subs.length} subs)`,
  );
};

const imageFiles = await listImageFiles();
const imageFilesByMeal = indexImageFilesByMeal(imageFiles);
const usedImageFiles = new Set();

console.log(`Indexed ${imageFiles.length} image files from ${ROOT_IMAGES_DIR}`);

for (const domain of Object.keys(schoolApps).sort((a, b) =>
  a.localeCompare(b),
)) {
  await updateDistrict(domain);

  const mealsFile = path.join(
    ROOT_MEALS_DIR,
    `${sanitizePathSegment(domain)}.json`,
  );
  const allMeals = JSON.parse(await readFile(mealsFile, "utf8"));

  const weatherByGridpoint = await loadWeather(
    Object.values(schoolApps[domain]).map((apps) => getAppBase(apps, "NWS")),
  );

  for (const school of Object.keys(schoolApps[domain]).sort((a, b) =>
    a.localeCompare(b),
  )) {
    await updateSchool(
      domain,
      school,
      getAppBase(schoolApps[domain][school], "NWS"),
      weatherByGridpoint,
      allMeals,
      imageFilesByMeal,
      usedImageFiles,
    );
  }
}

const unusedImageFiles = imageFiles.filter(
  (imageFile) => !usedImageFiles.has(imageFile),
);
if (unusedImageFiles.length > 0) {
  console.warn(
    `Unused meal images in ${ROOT_IMAGES_DIR}: ${unusedImageFiles.join(", ")}`,
  );
}

console.log("Finished.");
