import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { districtApps, schoolApps } from "school-districts";
import { loadMeals } from "./sources/meals.js";

const DATA_DIR = path.join(process.cwd(), "data");
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
    `Wrote master meals for ${domain} (${Object.keys(domainMeals).length} items) to ${filePath}`,
  );
}
