const USER_AGENT =
  "school-districts-data/0.1 (+https://github.com/KTibow/school-districts-data)";

export const fetchResponse = async (url, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);

  return await fetch(url, {
    ...init,
    headers,
  });
};

export const fetchText = async (url, init = {}) => {
  const response = await fetchResponse(url, init);
  if (!response.ok) {
    throw new Error(`${response.statusText}`);
  }
  return await response.text();
};

export const fetchJson = async (url, init = {}) =>
  JSON.parse(await fetchText(url, init));
