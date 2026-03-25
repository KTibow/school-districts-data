import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { districtApps, districtNews, schoolApps } from "school-districts";
import { loadDistrictAlerts } from "./sources/flashalert.js";
import { filterMeals } from "./sources/meals.js";
import { loadSubs } from "./sources/subs.js";
import { loadWeather } from "./sources/weather.js";

const DATA_DIR = path.join(process.cwd(), "data");
const ROOT_MEALS_DIR = path.join(DATA_DIR, "+meals");

const sanitizePathSegment = (value) => value.replaceAll("/", " - ");

const writeJson = async (filePath, data) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

const getAppBase = (apps, appName) =>
  apps.find((app) => app.app === appName).base;

const loadMasterMealsForDomain = async (domain) => {
  const mealsFile = path.join(ROOT_MEALS_DIR, `${sanitizePathSegment(domain)}.json`);
  return JSON.parse(await readFile(mealsFile, "utf8"));
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
  const meals = filterMeals(allMeals, school);

  await writeJson(schoolFile, {
    weather,
    meals,
    subs,
  });

  console.log(
    `Wrote school data for ${domain}/${school} (${Object.keys(weather).length} weather, ${Object.keys(meals).length} meals, ${subs.length} subs)`,
  );
};

for (const domain of Object.keys(schoolApps).sort((a, b) =>
  a.localeCompare(b),
)) {
  await updateDistrict(domain);

  const allMeals = await loadMasterMealsForDomain(domain);

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
    );
  }
}

console.log("Finished.");
