/** Use stock OpenFreeMap styles without custom paint overrides. */
export function basemapStyle(dark: boolean): string {
  return `https://tiles.openfreemap.org/styles/${dark ? "dark" : "liberty"}`;
}
