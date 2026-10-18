/** Store-name patterns â†’ brand site, used to fetch the chain's logo. */
const CHAIN_DOMAINS: [RegExp, string][] = [
  [/fred\s*meyer/i, 'fredmeyer.com'],
  [/safeway/i, 'safeway.com'],
  [/\bqfc\b|quality food cent/i, 'qfc.com'],
  [/trader\s*joe/i, 'traderjoes.com'],
  [/whole\s*foods/i, 'wholefoodsmarket.com'],
  [/uwajimaya/i, 'uwajimaya.com'],
  [/walmart/i, 'walmart.com'],
  [/grocery\s*outlet/i, 'groceryoutlet.com'],
  [/^target\b/i, 'target.com'],
  [/costco/i, 'costco.com'],
  [/winco/i, 'wincofoods.com'],
  [/\bpcc\b/i, 'pccmarkets.com'],
  [/haggen/i, 'haggen.com'],
  [/yoke'?s/i, 'yokesfreshmarkets.com'],
  [/metropolitan\s*market/i, 'metropolitan-market.com'],
  [/albertsons/i, 'albertsons.com'],
  [/\bh\s*mart\b/i, 'hmart.com'],
  [/sprouts/i, 'sprouts.com'],
  [/natural\s*grocers|vitamin\s*cottage/i, 'naturalgrocers.com'],
  [/town\s*&\s*country/i, 'tcmarkets.com'],
  [/rosauers/i, 'rosauers.com'],
  [/urm\s*cash|cash\s*&\s*carry/i, 'smartfoodservice.com'],
  [/kroger/i, 'kroger.com'],
];

export function storeLogoUrl(storeName: string | null | undefined): string | null {
  if (!storeName) return null;
  const match = CHAIN_DOMAINS.find(([pattern]) => pattern.test(storeName));
  return match ? `https://www.google.com/s2/favicons?domain=${match[1]}&sz=128` : null;
}
