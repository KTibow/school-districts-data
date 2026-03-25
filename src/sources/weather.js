import { fetchJson } from "../http.js";

const WIND_WORD = /\bwind\b/i;

const formatForecast = (forecast) =>
  forecast
    .split(/(?<=\.) /)
    .filter((sentence) => !WIND_WORD.test(sentence))
    .join(" ");

const processForecast = (data) =>
  Object.fromEntries(
    data.properties.periods
      .filter((period) => period.isDaytime)
      .map((period) => [
        period.startTime.slice(0, 10),
        formatForecast(period.detailedForecast ?? ""),
      ])
      .filter(([, forecast]) => forecast)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

export const loadWeather = async (forecastBases) =>
  Object.fromEntries(
    await Promise.all(
      [...new Set(forecastBases)]
        .sort((a, b) => a.localeCompare(b))
        .map(async (forecastBase) => [
          forecastBase,
          processForecast(await fetchJson(`${forecastBase}/forecast`)),
        ]),
    ),
  );
