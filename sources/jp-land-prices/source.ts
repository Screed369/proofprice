// Japan: official land prices (地価公示, Land Price Publication) by the Ministry of Land, Infrastructure, Transport and Tourism (MLIT),
// from the National Land Numerical Information download site (国土数値情報, dataset L01). Format checked live on 2026-11-01:
// plain GET of https://nlftp.mlit.go.jp/ksj/gml/data/L01/L01-26/L01-26_13_GML.zip (Tokyo, 2.2 MB, zip method "store") holds
// L01-26_13.geojson with 2,560 Point features. Properties used: L01_004 municipality code (JIS, 5 digits), L01_007 survey year (2026),
// L01_008 price in yen per m² on 1 January, L01_009 change on the year before in %, L01_024 municipality name (Japanese, "渋谷"),
// L01_028 current use ("住宅", "店舗,事務所"), L01_051 zoning ("商業", "近商", "1低専"). Editions L01-25 and L01-26 share this layout; older
// editions (L01-23) use other field numbers, so we only accept an edition whose L01_007 equals its own year.
// These are appraisals by licensed appraisers of benchmark plots, NOT recorded sales. Aggregates only: at least 5 plots per answer.

import { inflateRawSync } from "node:zlib";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";

export const BASE = "https://nlftp.mlit.go.jp/ksj/gml/data/L01";

export const INFO: SourceInfo = {
  id: "jp-land-prices",
  country: "JP (Japan)",
  category: "land prices (official annual appraisals)",
  name: "Land Price Publication (地価公示), National Land Numerical Information dataset L01",
  publisher: "Ministry of Land, Infrastructure, Transport and Tourism (MLIT), Japan",
  what_is_recorded:
    "Each year, for about 26,000 benchmark plots across Japan, the price per m² of the land on 1 January as appraised by licensed real-estate appraisers: municipality, current use, zoning and the change on the year before. The plots are chosen to represent their area; the figures are appraisals, not recorded sales.",
  price_type: "posted_price",
  freshness: "Annual: the 1 January valuation published each March (the 2026 edition is out). Every answer states the edition year",
  licence: "Public Data License 1.0 (PDL1.0, compatible with CC BY 4.0): commercial reuse allowed with a source credit; changes must be stated",
  licence_url: "https://nlftp.mlit.go.jp/ksj/other/agreement.html",
  attribution:
    "出典：国土交通省 国土数値情報ダウンロードサイト「地価公示データ」(https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L01-v3_1.html) を加工して作成 / Source: MLIT National Land Numerical Information, Land Price Publication data (L01), processed by ProofPrice (summary statistics per area). Not an MLIT publication.",
  homepage: "https://nlftp.mlit.go.jp/ksj/",
  limits:
    "Official appraisals of benchmark plots as at 1 January, not recorded sales and not asking prices, and the plots are chosen by the authority (not a random sample). Price per m² of land (not of floor area). Annual. Aggregates only: at least 5 plots per answer. One prefecture per question.",
};

const EVIDENCE = {
  label: "Official land-price appraisal",
  meaning:
    "The value per m² that licensed appraisers set for a benchmark plot as at 1 January, published by the Japanese government: it is an expert appraisal of what the land is worth, not a record of a completed sale and not an asking price.",
};

// ---------- places (pure) ----------

export const PREFECTURES: { code: string; en: string; ja: string }[] = [
  ["01", "Hokkaido", "北海道"], ["02", "Aomori", "青森県"], ["03", "Iwate", "岩手県"], ["04", "Miyagi", "宮城県"], ["05", "Akita", "秋田県"],
  ["06", "Yamagata", "山形県"], ["07", "Fukushima", "福島県"], ["08", "Ibaraki", "茨城県"], ["09", "Tochigi", "栃木県"], ["10", "Gunma", "群馬県"],
  ["11", "Saitama", "埼玉県"], ["12", "Chiba", "千葉県"], ["13", "Tokyo", "東京都"], ["14", "Kanagawa", "神奈川県"], ["15", "Niigata", "新潟県"],
  ["16", "Toyama", "富山県"], ["17", "Ishikawa", "石川県"], ["18", "Fukui", "福井県"], ["19", "Yamanashi", "山梨県"], ["20", "Nagano", "長野県"],
  ["21", "Gifu", "岐阜県"], ["22", "Shizuoka", "静岡県"], ["23", "Aichi", "愛知県"], ["24", "Mie", "三重県"], ["25", "Shiga", "滋賀県"],
  ["26", "Kyoto", "京都府"], ["27", "Osaka", "大阪府"], ["28", "Hyogo", "兵庫県"], ["29", "Nara", "奈良県"], ["30", "Wakayama", "和歌山県"],
  ["31", "Tottori", "鳥取県"], ["32", "Shimane", "島根県"], ["33", "Okayama", "岡山県"], ["34", "Hiroshima", "広島県"], ["35", "Yamaguchi", "山口県"],
  ["36", "Tokushima", "徳島県"], ["37", "Kagawa", "香川県"], ["38", "Ehime", "愛媛県"], ["39", "Kochi", "高知県"], ["40", "Fukuoka", "福岡県"],
  ["41", "Saga", "佐賀県"], ["42", "Nagasaki", "長崎県"], ["43", "Kumamoto", "熊本県"], ["44", "Oita", "大分県"], ["45", "Miyazaki", "宮崎県"],
  ["46", "Kagoshima", "鹿児島県"], ["47", "Okinawa", "沖縄県"],
].map(([code, en, ja]) => ({ code, en, ja }));

/** The 23 special wards of Tokyo: English name -> the name the file uses (no 区 suffix). */
export const TOKYO_WARDS: Record<string, string> = {
  chiyoda: "千代田", chuo: "中央", minato: "港", shinjuku: "新宿", bunkyo: "文京", taito: "台東", sumida: "墨田", koto: "江東",
  shinagawa: "品川", meguro: "目黒", ota: "大田", setagaya: "世田谷", shibuya: "渋谷", nakano: "中野", suginami: "杉並", toshima: "豊島",
  kita: "北", arakawa: "荒川", itabashi: "板橋", nerima: "練馬", adachi: "足立", katsushika: "葛飾", edogawa: "江戸川",
};

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const stripSuffix = (s: string) => s.replace(/[都道府県市区町村]$/u, "");

export interface Place {
  prefecture: { code: string; en: string; ja: string };
  /** Municipality name as the file spells it (Japanese), or null for the whole prefecture. */
  municipality: string | null;
  /** How the place was understood, for the answer. */
  label: string;
}

/** Pure: understand prefecture + town. Town may be a prefecture, a Tokyo ward (English or Japanese), or a Japanese municipality name
 *  (then the prefecture must be given). Throws InputError with the valid choices. */
export function resolvePlace(prefecture?: string, town?: string): Place {
  const pref = prefecture?.trim();
  const t = town?.trim();
  const findPref = (s: string) => {
    const n = norm(s);
    const nj = stripSuffix(s.normalize("NFKC").trim());
    return PREFECTURES.find((p) => p.code === n.padStart(2, "0") || norm(p.en) === n || p.ja === s.trim() || stripSuffix(p.ja) === nj);
  };
  let p = pref ? findPref(pref) : undefined;
  if (pref && !p) throw new InputError(`Japan: prefecture "${pref}" not recognised. Use an English name (Tokyo, Osaka, Hokkaido, Okinawa...), the Japanese name (東京都) or the 2-digit JIS code (13).`);
  if (!t) {
    if (!p) throw new InputError("Japan: give a prefecture (extra parameter prefecture, e.g. Tokyo, Osaka, Aichi) or a town (a Tokyo ward such as Shibuya, or a Japanese municipality name with the prefecture). One prefecture per question.");
    return { prefecture: p, municipality: null, label: `${p.en} prefecture` };
  }
  if (t.length < 1) throw new InputError("town must be a municipality name.");
  const asPref = findPref(t);
  if (asPref && !p) return { prefecture: asPref, municipality: null, label: `${asPref.en} prefecture` };
  const ward = TOKYO_WARDS[norm(t).replace(/ ku$/, "").replace(/\s+/g, "")];
  const tokyo = PREFECTURES.find((x) => x.code === "13")!;
  if (ward && (!p || p.code === "13")) return { prefecture: tokyo, municipality: ward, label: `${ward}区 (${t}), Tokyo` };
  if (!p) {
    const ja = stripSuffix(t.normalize("NFKC"));
    if (Object.values(TOKYO_WARDS).includes(ja)) return { prefecture: tokyo, municipality: ja, label: `${ja}区, Tokyo` };
    throw new InputError(`Japan: add the prefecture for town "${t}" (extra parameter prefecture, e.g. prefecture=Osaka). English town names are understood for the 23 Tokyo wards; elsewhere use the Japanese name as the file spells it.`);
  }
  return { prefecture: p, municipality: t.normalize("NFKC"), label: `${t.normalize("NFKC")}, ${p.en}` };
}

// ---------- zip (pure) ----------

/** Read the first entry whose name ends with `suffix` from a zip held in memory (central directory, then stored or raw deflate). */
export function unzipEntry(buf: Buffer, suffix: string): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("MLIT download is not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new SourceError("MLIT zip has a bad directory");
    const method = buf.readUInt16LE(cd + 10);
    const csize = buf.readUInt32LE(cd + 20);
    const nlen = buf.readUInt16LE(cd + 28);
    const elen = buf.readUInt16LE(cd + 30);
    const clen = buf.readUInt16LE(cd + 32);
    const lho = buf.readUInt32LE(cd + 42);
    const name = buf.toString("utf8", cd + 46, cd + 46 + nlen);
    if (name.toLowerCase().endsWith(suffix)) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("MLIT zip has a bad entry");
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new SourceError(`MLIT zip uses an unsupported method (${method})`);
    }
    cd += 46 + nlen + elen + clen;
  }
  throw new SourceError(`MLIT zip holds no ${suffix} file`);
}

// ---------- points (pure) ----------

export interface Plot {
  municipalityCode: string;
  municipality: string;
  price: number; // yen per m²
  changePct: number | null;
  zoning: string;
  use: string;
}

export interface ParsedPlots {
  year: number;
  plots: Plot[];
  rows: number;
  dropped: number;
}

/** Pure: GeoJSON text of one prefecture -> plots. A feature without a positive price, a municipality or a code is counted and dropped.
 *  Throws SourceError when the edition does not look like the layout we know (so a changed layout is never answered wrongly). */
export function parsePlots(geojson: string, expectYear: number): ParsedPlots {
  let doc: any;
  try {
    doc = JSON.parse(geojson);
  } catch {
    throw new SourceError("MLIT land-price file is not valid JSON");
  }
  const feats: any[] = Array.isArray(doc?.features) ? doc.features : [];
  const plots: Plot[] = [];
  let dropped = 0;
  for (const f of feats) {
    const p = f?.properties ?? {};
    const price = Number(p.L01_008);
    const code = String(p.L01_004 ?? "");
    const muni = String(p.L01_024 ?? "").trim();
    if (Number(p.L01_007) !== expectYear || !Number.isFinite(price) || price < 1_000 || price > 100_000_000 || !/^\d{5}$/.test(code) || !muni) {
      dropped++;
      continue;
    }
    const ch = Number(p.L01_009);
    plots.push({
      municipalityCode: code,
      municipality: muni,
      price,
      changePct: Number.isFinite(ch) ? ch : null,
      zoning: String(p.L01_051 ?? "").trim(),
      use: String(p.L01_028 ?? "").trim(),
    });
  }
  if (feats.length < 20 || plots.length < feats.length * 0.9) throw new SourceError("The MLIT land-price file does not look like the layout we expect; this source needs updating.");
  return { year: expectYear, plots, rows: feats.length, dropped };
}

/** Commercial and industrial zoning (商業, 近隣商業, 準工業, 工業, 工業専用) as the file abbreviates it. */
export const COMMERCIAL_ZONES = new Set(["商業", "近商", "準工", "工業", "工専"]);

// ---------- answer (pure) ----------

export interface JpInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  months?: number;
  prefecture?: string;
  baseUrl?: string;
}

const METHOD =
  "Median and 10th-90th percentile of the official appraised land price per m² (yen) across the Land Price Publication benchmark plots in the chosen prefecture or municipality, valuation date 1 January of the edition year. " +
  "Appraisals by licensed appraisers for the Ministry of Land, Infrastructure, Transport and Tourism, not recorded sales; the plots are chosen by the authority to represent each area. We compute the summary; MLIT does not publish it.";

export function answerFromPlots(parsed: ParsedPlots, place: Place, input: JpInput): PriceAnswer {
  if (input.postcode !== undefined && input.postcode.trim() !== "") {
    throw new InputError("Japan: postcodes are not supported; give a prefecture and a town (a Tokyo ward such as Shibuya, or a Japanese municipality name).");
  }
  const type = (input.property_type ?? "land").trim().toLowerCase();
  if (type !== "land" && type !== "commercial") throw new InputError('property_type must be "land" (all benchmark plots, the default) or "commercial" (plots in commercial or industrial zones).');
  const inPlace = parsed.plots.filter((x) => place.municipality === null || x.municipality === place.municipality);
  const picked = type === "commercial" ? inPlace.filter((x) => COMMERCIAL_ZONES.has(x.zoning)) : inPlace;
  const summary = summarise(picked.map((x) => x.price));
  const changes = picked.map((x) => x.changePct).filter((c): c is number => c !== null).sort((a, b) => a - b);
  const medChange = changes.length ? changes[Math.floor((changes.length - 1) / 2)] : null;
  const municipalities = [...new Set(parsed.plots.map((x) => x.municipality))].sort();
  const date = `${parsed.year}-01-01`;
  const what = type === "commercial" ? "commercial and industrial zoned benchmark plots" : "benchmark plots";
  return buildAnswer({
    source: INFO,
    query: { country: "JP", prefecture: place.prefecture.en, town: place.municipality, property_type: type },
    summary,
    currency: "JPY",
    unit: "per m² of land",
    period: { from: date, to: date },
    method: METHOD,
    evidence: EVIDENCE,
    describe: (x) =>
      `Official ${parsed.year} appraisals of ${what} in ${place.label} put land at a median of ${fmtMoney(x.median, "JPY")} per m²; 10th-90th percentile range ${fmtMoney(x.low, "JPY")}-${fmtMoney(x.high, "JPY")}. ` +
      "These are government-appointed appraisers' valuations as at 1 January, not recorded sales and not asking prices.",
    baseUrl: input.baseUrl,
    extra: {
      edition_year: parsed.year,
      valuation_date: date,
      prefecture: place.prefecture.en,
      prefecture_ja: place.prefecture.ja,
      median_change_on_year_before_pct: medChange,
      plots_in_prefecture: parsed.plots.length,
      municipalities_available: municipalities.slice(0, 120),
      caveat: "Annual appraisals of benchmark plots chosen by the authority, not sales. Price per m² of land. Tokyo wards can be given in English (Shibuya, Minato); other towns by the Japanese name in municipalities_available.",
    },
  });
}

// ---------- fetch ----------

const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

/** Newest edition first: the 1 January valuation is published in March, so try this year, then the two before. */
export function editionYears(now = new Date()): number[] {
  const y = now.getUTCFullYear();
  return [y, y - 1, y - 2];
}

export async function fetchPrefecture(code: string, now = new Date()): Promise<ParsedPlots> {
  let lastErr = "no edition found";
  for (const year of editionYears(now)) {
    const yy = String(year).slice(-2);
    const url = `${BASE}/L01-${yy}/L01-${yy}_${code}_GML.zip`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25_000) });
    } catch (e) {
      throw new SourceError(`MLIT download failed: ${(e as Error).message}`);
    }
    if (res.status === 404) {
      lastErr = `edition ${year} not published yet`;
      continue;
    }
    if (!res.ok) throw new SourceError(`MLIT returned HTTP ${res.status}`);
    const text = unzipEntry(Buffer.from(await res.arrayBuffer()), ".geojson").toString("utf8");
    return parsePlots(text, year);
  }
  throw new SourceError(`MLIT land prices: ${lastErr}`);
}

export async function jpLandPrices(input: JpInput, fetcher?: (code: string) => Promise<ParsedPlots>): Promise<PriceAnswer> {
  const place = resolvePlace(input.prefecture, input.town);
  const parsed = await (fetcher ?? ((c: string) => fetchPrefecture(c)))(place.prefecture.code);
  return answerFromPlots(parsed, place, input);
}
