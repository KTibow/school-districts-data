import { fetchJson } from "../http.js";

const WIND_WORD = /\bwind\b/i;

const formatForecast = (forecast) =>
  forecast
    .split(/(?<=\.) /)
    .filter((sentence) => !WIND_WORD.test(sentence))
    .join(" ");

const weatherCache = new Map();

export const loadWeather = async (forecastBase) => {
  if (weatherCache.has(forecastBase)) {
    return weatherCache.get(forecastBase);
  }

  const promise = (async () => {
    const data = await fetchJson(`${forecastBase}/forecast`);

    return Object.fromEntries(
      data.properties.periods
        .filter((period) => period.isDaytime)
        .map((period) => [
          period.startTime.slice(0, 10),
          formatForecast(period.detailedForecast ?? ""),
        ])
        .filter(([, forecast]) => forecast)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  })();

  weatherCache.set(forecastBase, promise);
  return await promise;
};
