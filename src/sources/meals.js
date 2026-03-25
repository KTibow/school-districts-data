const sortedEntries = (obj) =>
  Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));

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
