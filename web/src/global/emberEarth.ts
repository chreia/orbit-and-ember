export interface EarthCell { lon: number; lat: number; count: number }
export interface EarthHistory {
  sourceUrl: string;
  world: number[];
  countries: Record<string, { name: string; months: number[] }>;
}
export interface EarthAtlas {
  history: EarthHistory;
  bounds: Record<string, [number, number, number, number]>;
}
export interface EarthArea {
  code: string;
  name: string;
  bounds: [number, number, number, number] | null;
  /** Historical data is for this country, even if the camera focuses on a smaller place. */
  historyCode: string | null;
  local: boolean;
}
export interface EarthReport {
  area: EarthArea;
  detections: number;
  activeCells: number;
  topCells: EarthCell[];
  seasonal: number[] | null;
  peakMonths: number[];
  historicalName: string | null;
  unusual: { month: number; burned: number; typical: number; multiple: number; direction: 'above' | 'below' } | null;
}

const normalize = (s: string) => ` ${s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\bst\b/g, 'saint').trim()} `;
const contains = (query: string, phrase: string) => query.includes(normalize(phrase));
const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : 0;
};

const places: Array<{ name: string; aliases: string[]; bounds: [number, number, number, number]; historyCode: string | null }> = [
  { name: 'Monaco', aliases: ['monaco'], bounds: [7.409, 43.724, 7.441, 43.752], historyCode: null },
  { name: 'Vatican City', aliases: ['vatican', 'vatican city', 'holy see'], bounds: [12.445, 41.9, 12.459, 41.908], historyCode: null },
  { name: 'Marshall Islands', aliases: ['marshall islands'], bounds: [160.8, 4.5, 172.2, 14.8], historyCode: null },
  { name: 'New York', aliases: ['new york', 'new york state', 'ny state'], bounds: [-79.77, 40.49, -71.85, 45.02], historyCode: 'USA' },
  { name: 'New York City', aliases: ['new york city', 'nyc'], bounds: [-74.26, 40.49, -73.7, 40.92], historyCode: 'USA' },
  { name: 'California', aliases: ['california'], bounds: [-124.5, 32.4, -114.1, 42.1], historyCode: 'USA' },
  { name: 'Western United States', aliases: ['western us', 'western usa', 'western united states', 'american west'], bounds: [-125, 31, -102, 49], historyCode: 'USA' },
  { name: 'Amazon Basin', aliases: ['amazon', 'amazon rainforest', 'amazon basin'], bounds: [-80, -20, -47, 5], historyCode: null },
  { name: 'Mediterranean', aliases: ['mediterranean'], bounds: [-12, 29, 42, 48], historyCode: null },
  { name: 'Southeast Asia', aliases: ['southeast asia', 'south east asia'], bounds: [92, -12, 142, 24], historyCode: null },
  { name: 'Siberia', aliases: ['siberia'], bounds: [60, 50, 179, 75], historyCode: 'RUS' },
  { name: 'North America', aliases: ['north america'], bounds: [-168, 7, -52, 72], historyCode: null },
  { name: 'South America', aliases: ['south america'], bounds: [-82, -57, -34, 14], historyCode: null },
  { name: 'Africa', aliases: ['africa'], bounds: [-18, -35, 52, 38], historyCode: null },
  { name: 'Europe', aliases: ['europe'], bounds: [-12, 35, 45, 72], historyCode: null },
  { name: 'Asia', aliases: ['asia'], bounds: [26, -12, 180, 78], historyCode: null },
];
const countryAliases: Record<string, string[]> = {
  USA: ['usa', 'u s a', 'us', 'u s', 'united states', 'united states of america', 'america'],
  GBR: ['uk', 'u k', 'britain', 'great britain', 'united kingdom'],
  RUS: ['russia'],
  COD: ['dr congo', 'd r congo', 'democratic republic of congo'],
  KOR: ['south korea'],
  PRK: ['north korea'],
  CIV: ['ivory coast'],
  VCT: ['saint vincent', 'st vincent'],
  KNA: ['saint kitts', 'st kitts', 'saint kitts and nevis'],
  TLS: ['east timor', 'timor leste'],
  CPV: ['cape verde', 'cabo verde'],
  SWZ: ['eswatini', 'swaziland'],
};

// Includes adjacent transpositions, common in quickly typed place names.
function spellingDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

export function resolveEarthArea(message: string, atlas: EarthAtlas, suggestions?: EarthArea[]): EarthArea | null {
  const query = normalize(message);
  const candidates: Array<{ phrase: string; area: EarthArea }> = [];
  for (const place of places) for (const phrase of place.aliases) candidates.push({ phrase, area: {
    code: place.historyCode ?? 'world', name: place.name, bounds: place.bounds,
    historyCode: place.historyCode, local: true,
  } });
  for (const [code, country] of Object.entries(atlas.history.countries)) {
    const bounds = atlas.bounds[code];
    if (!bounds) continue;
    for (const phrase of [country.name, code, ...(countryAliases[code] ?? [])]) candidates.push({ phrase, area: {
      code, name: country.name, bounds, historyCode: code, local: false,
    } });
  }
  // Longer names win: “South Africa” must not resolve to the continent of Africa.
  candidates.sort((a, b) => normalize(b.phrase).length - normalize(a.phrase).length);
  const match = candidates.find(({ phrase }) => contains(query, phrase));
  if (match) return match.area;
  if (['whole world', 'worldwide', 'entire earth', 'whole earth', 'the globe', 'the world'].some(phrase => contains(query, phrase))) {
    return { code: 'world', name: 'Whole world', bounds: null, historyCode: 'world', local: false };
  }
  const words = query.trim().split(/\s+/);
  const ranked = new Map<string, { score: number; area: EarthArea }>();
  for (const candidate of candidates) {
    const name = normalize(candidate.phrase).trim();
    if (name.length < 4 || /^[A-Z]{3}$/.test(candidate.phrase)) continue;
    const wordCount = name.split(' ').length;
    for (let start = 0; start < words.length; start++) for (const length of [wordCount, wordCount - 1, wordCount + 1]) {
      if (length < 1 || start + length > words.length) continue;
      const part = words.slice(start, start + length).join(' ');
      if (/^(show|outline|please|focus|fires|where|about|earth|there|select|country|world)$/.test(part)) continue;
      const distance = spellingDistance(name, part);
      const limit = name.length >= 8 ? 2 : 1;
      const score = 1 - distance / Math.max(name.length, part.length);
      if (distance > limit || score < 0.75) continue;
      const key = candidate.area.name;
      if (score > (ranked.get(key)?.score ?? 0)) ranked.set(key, { score, area: candidate.area });
    }
  }
  const matches = [...ranked.values()].sort((a, b) => b.score - a.score);
  if (matches[0] && (!matches[1] || matches[0].score - matches[1].score >= 0.08)) return matches[0].area;
  if (matches.length) suggestions?.push(...matches.slice(0, 3).map(match => match.area));
  return null;
}

export const wantsEarthSelection = (message: string) => /\b(outl\w*|highlight|mark|locate|center|centre|display|draw|show|select|focus|zoom|fly|visit|navigate|take me|go to|look at|explore|find|where|anomal\w*|fire.prone|fire season|burning season|tell me about)\b/i.test(message);
export const wantsActivity = (message: string) => /\b(most active|highest|hottest|hotspot|fire.prone|fire activity|where are fires|find fires)\b/i.test(message);
export const wantsAnomaly = (message: string) => /\b(anomal\w*|unusual|above usual|different from usual|fire.prone|fire season|burning season|historical|history)\b/i.test(message);

export function inEarthArea(cell: EarthCell, bounds: EarthArea['bounds']): boolean {
  if (!bounds) return true;
  const [west, south, east, north] = bounds;
  const lon = ((cell.lon + 180) % 360 + 360) % 360 - 180;
  return cell.lat >= south && cell.lat <= north && (west <= east ? lon >= west && lon <= east : lon >= west || lon <= east);
}

export function earthReport(area: EarthArea, atlas: EarthAtlas, cells: EarthCell[]): EarthReport {
  const inside = cells.filter(cell => inEarthArea(cell, area.bounds) && cell.count > 0);
  const topCells = [...inside].sort((a, b) => b.count - a.count).slice(0, 3);
  const values = area.historyCode === 'world' ? atlas.history.world : area.historyCode ? atlas.history.countries[area.historyCode]?.months : null;
  const seasonal = values?.length === 288 ? Array.from({ length: 12 }, (_, month) => median(
    Array.from({ length: 23 }, (_, year) => values[year * 12 + month]).filter(Number.isFinite),
  )) : null;
  const peakMonths = seasonal ? [...seasonal.keys()].sort((a, b) => seasonal[b] - seasonal[a]).slice(0, 3) : [];
  const unusual = seasonal && values ? Array.from({ length: 12 }, (_, month) => {
    const burned = values[23 * 12 + month];
    const typical = seasonal[month];
    return { month, burned, typical, multiple: typical > 0 ? burned / typical : 0,
      direction: burned >= typical ? 'above' as const : 'below' as const };
  }).filter(item => item.typical >= 1000 && (item.multiple >= 1.5 || item.multiple <= 2 / 3))
    .sort((a, b) => Math.abs(Math.log2((b.burned + 100) / (b.typical + 100))) - Math.abs(Math.log2((a.burned + 100) / (a.typical + 100))))[0] ?? null : null;
  return {
    area, detections: inside.reduce((sum, cell) => sum + cell.count, 0), activeCells: inside.length,
    topCells, seasonal, peakMonths,
    historicalName: area.historyCode === 'world' ? 'Whole world' : area.historyCode ? atlas.history.countries[area.historyCode]?.name ?? null : null,
    unusual,
  };
}
