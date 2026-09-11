export const BRANCH_MAP_PROVIDERS = [
  "yandex_maps",
  "google_maps",
  "two_gis",
] as const;

export type BranchMapProvider = (typeof BRANCH_MAP_PROVIDERS)[number];

export type BranchMapLink = {
  provider: BranchMapProvider;
  url: string;
};

/** Builds provider-owned search URLs without sending the address to another API. */
export function buildBranchMapLinks(address: string): BranchMapLink[] {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) return [];
  const query = encodeURIComponent(normalizedAddress);
  return [
    {
      provider: "yandex_maps",
      url: `https://yandex.ru/maps/?text=${query}`,
    },
    {
      provider: "google_maps",
      url: `https://www.google.com/maps/search/?api=1&query=${query}`,
    },
    {
      provider: "two_gis",
      url: `https://2gis.ru/search/${query}`,
    },
  ];
}
