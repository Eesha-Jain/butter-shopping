const url = new URL(
  "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0/query",
);
url.searchParams.set("where", "State='WA'");
url.searchParams.set("outFields", "Store_Type");
url.searchParams.set("returnGeometry", "false");
url.searchParams.set("returnDistinctValues", "true");
url.searchParams.set("f", "json");
url.searchParams.set("orderByFields", "Store_Type");
url.searchParams.set("resultRecordCount", "200");
const json = await (await fetch(url)).json();
if (json.error) {
  console.log(JSON.stringify(json.error));
  process.exit(1);
}
for (const feature of json.features ?? []) {
  console.log(feature.attributes?.Store_Type);
}
