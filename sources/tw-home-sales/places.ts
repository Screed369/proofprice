// Taiwan places for tw-home-sales and tw-rents: the 22 cities and counties and their districts / townships (about 370), with
// Chinese names exactly as the Ministry of the Interior's register writes them (臺, not 台) and English names (Hanyu Pinyin
// plus the common Wade-Giles and Taiwanese spellings). Matching accepts English or Chinese, with or without "District",
// "City", "區", "市"..., "Da'an, Taipei", "Taipei Da'an", "臺北市大安區", "台北大安". A name that exists in several cities
// (Da'an: Taipei and Taichung; Zhongzheng: Taipei and Keelung) is reported as ambiguous, never guessed.

import { CITY_BY_CODE } from "./moi";

interface CityDef {
  code: string;
  en: string; // display name
  aliases: string[]; // English spellings (before folding); Chinese forms come from CITY_BY_CODE
  d: string; // districts: "中正區:Zhongzheng/Chungcheng ..." (zh:English names, "/" separates spellings, "_" is a space)
}

const CITIES: CityDef[] = [
  { code: "A", en: "Taipei City", aliases: ["Taipei", "Taipei City"], d: "中正區:Zhongzheng/Chungcheng 大同區:Datong/Tatung 中山區:Zhongshan/Chungshan 松山區:Songshan/Sungshan 大安區:Da'an/Daan/Ta-an 萬華區:Wanhua/Wanhwa 信義區:Xinyi/Hsinyi 士林區:Shilin/Shihlin 北投區:Beitou/Peitou 內湖區:Neihu/Nei-hu 南港區:Nangang/Nankang 文山區:Wenshan" },
  { code: "F", en: "New Taipei City", aliases: ["New Taipei", "New Taipei City", "Xinbei", "Hsinpei", "Taipei County"], d: "板橋區:Banqiao/Panchiao 三重區:Sanchong/Sanchung 中和區:Zhonghe/Chunghe 永和區:Yonghe/Yungho 新莊區:Xinzhuang/Hsinchuang 新店區:Xindian/Hsintien 樹林區:Shulin 鶯歌區:Yingge 三峽區:Sanxia/Sanshia 淡水區:Tamsui/Danshui/Tanshui 汐止區:Xizhi/Hsichih 瑞芳區:Ruifang 土城區:Tucheng/Tuchen 蘆洲區:Luzhou/Lujhou 五股區:Wugu 泰山區:Taishan 林口區:Linkou 深坑區:Shenkeng 石碇區:Shiding 坪林區:Pinglin 三芝區:Sanzhi 石門區:Shimen 八里區:Bali 平溪區:Pingxi 雙溪區:Shuangxi 貢寮區:Gongliao 金山區:Jinshan 萬里區:Wanli 烏來區:Wulai" },
  { code: "H", en: "Taoyuan City", aliases: ["Taoyuan", "Taoyuan City"], d: "桃園區:Taoyuan 中壢區:Zhongli/Chungli/Jhongli 平鎮區:Pingzhen/Pingchen/Pingjhen 八德區:Bade 楊梅區:Yangmei 蘆竹區:Luzhu 大溪區:Daxi/Tahsi 龍潭區:Longtan/Lungtan 龜山區:Guishan/Kueishan 大園區:Dayuan 觀音區:Guanyin 新屋區:Xinwu 復興區:Fuxing" },
  { code: "B", en: "Taichung City", aliases: ["Taichung", "Taichung City"], d: "中區:Central 東區:East 南區:South 西區:West 北區:North 北屯區:Beitun/Peitun 西屯區:Xitun/Hsitun 南屯區:Nantun 太平區:Taiping 大里區:Dali 霧峰區:Wufeng 烏日區:Wuri 豐原區:Fengyuan 后里區:Houli 石岡區:Shigang 東勢區:Dongshi 和平區:Heping 新社區:Xinshe 潭子區:Tanzi 大雅區:Daya 神岡區:Shengang 大肚區:Dadu 沙鹿區:Shalu 龍井區:Longjing 梧棲區:Wuqi 清水區:Qingshui/Chingshui 大甲區:Dajia 外埔區:Waipu 大安區:Da'an/Daan" },
  { code: "D", en: "Tainan City", aliases: ["Tainan", "Tainan City"], d: "中西區:West_Central 東區:East 南區:South 北區:North 安平區:Anping 安南區:Annan 永康區:Yongkang 歸仁區:Guiren 新化區:Xinhua 左鎮區:Zuozhen 玉井區:Yujing 楠西區:Nanxi 南化區:Nanhua 仁德區:Rende 關廟區:Guanmiao 龍崎區:Longqi 官田區:Guantian 麻豆區:Madou 佳里區:Jiali 西港區:Xigang 七股區:Qigu 將軍區:Jiangjun 學甲區:Xuejia 北門區:Beimen 新營區:Xinying 後壁區:Houbi 白河區:Baihe 東山區:Dongshan 六甲區:Liujia 下營區:Xiaying 柳營區:Liuying 鹽水區:Yanshui 善化區:Shanhua 大內區:Danei 山上區:Shanshang 新市區:Xinshi 安定區:Anding" },
  { code: "E", en: "Kaohsiung City", aliases: ["Kaohsiung", "Kaohsiung City"], d: "楠梓區:Nanzi/Nanzih 左營區:Zuoying/Tsoying 鼓山區:Gushan/Kushan 三民區:Sanmin 鹽埕區:Yancheng 前金區:Qianjin 新興區:Xinxing 苓雅區:Lingya 前鎮區:Qianzhen 旗津區:Qijin 小港區:Xiaogang/Siaogang 鳳山區:Fengshan/Fongshan 林園區:Linyuan 大寮區:Daliao 大樹區:Dashu 大社區:Dashe 仁武區:Renwu 鳥松區:Niaosong 岡山區:Gangshan 橋頭區:Qiaotou 燕巢區:Yanchao 田寮區:Tianliao 阿蓮區:Alian 路竹區:Luzhu 湖內區:Hunei 茄萣區:Qieding 永安區:Yong'an 彌陀區:Mituo 梓官區:Ziguan 旗山區:Qishan/Chishan 美濃區:Meinong 六龜區:Liugui 甲仙區:Jiaxian 杉林區:Shanlin 內門區:Neimen 茂林區:Maolin 桃源區:Taoyuan 那瑪夏區:Namaxia" },
  { code: "C", en: "Keelung City", aliases: ["Keelung", "Keelung City", "Jilong", "Chilung"], d: "仁愛區:Ren'ai/Renai 中正區:Zhongzheng/Chungcheng 信義區:Xinyi/Hsinyi 中山區:Zhongshan/Chungshan 安樂區:Anle 暖暖區:Nuannuan 七堵區:Qidu" },
  { code: "O", en: "Hsinchu City", aliases: ["Hsinchu", "Hsinchu City", "Xinzhu", "Xinzhu City"], d: "東區:East 北區:North 香山區:Xiangshan" },
  { code: "J", en: "Hsinchu County", aliases: ["Hsinchu", "Hsinchu County", "Xinzhu", "Xinzhu County"], d: "竹北市:Zhubei/Chupei 竹東鎮:Zhudong 新埔鎮:Xinpu 關西鎮:Guanxi 湖口鄉:Hukou 新豐鄉:Xinfeng 芎林鄉:Qionglin 橫山鄉:Hengshan 北埔鄉:Beipu 寶山鄉:Baoshan 峨眉鄉:Emei 尖石鄉:Jianshi 五峰鄉:Wufeng" },
  { code: "K", en: "Miaoli County", aliases: ["Miaoli", "Miaoli County"], d: "苗栗市:Miaoli 頭份市:Toufen 竹南鎮:Zhunan 後龍鎮:Houlong 通霄鎮:Tongxiao 苑裡鎮:Yuanli 卓蘭鎮:Zhuolan 造橋鄉:Zaoqiao 西湖鄉:Xihu 頭屋鄉:Touwu 公館鄉:Gongguan 銅鑼鄉:Tongluo 三義鄉:Sanyi 大湖鄉:Dahu 獅潭鄉:Shitan 三灣鄉:Sanwan 南庄鄉:Nanzhuang 泰安鄉:Tai'an" },
  { code: "N", en: "Changhua County", aliases: ["Changhua", "Changhua County"], d: "彰化市:Changhua 員林市:Yuanlin 和美鎮:Hemei 鹿港鎮:Lukang 溪湖鎮:Xihu 二林鎮:Erlin 田中鎮:Tianzhong 北斗鎮:Beidou 花壇鄉:Huatan 芬園鄉:Fenyuan 大村鄉:Dacun 永靖鄉:Yongjing 伸港鄉:Shengang 線西鄉:Xianxi 福興鄉:Fuxing 秀水鄉:Xiushui 埔心鄉:Puxin 埔鹽鄉:Puyan 大城鄉:Dacheng 芳苑鄉:Fangyuan 竹塘鄉:Zhutang 社頭鄉:Shetou 二水鄉:Ershui 田尾鄉:Tianwei 埤頭鄉:Pitou 溪州鄉:Xizhou" },
  { code: "M", en: "Nantou County", aliases: ["Nantou", "Nantou County"], d: "南投市:Nantou 埔里鎮:Puli 草屯鎮:Caotun 竹山鎮:Zhushan 集集鎮:Jiji 名間鄉:Mingjian 鹿谷鄉:Lugu 中寮鄉:Zhongliao 魚池鄉:Yuchi 國姓鄉:Guoxing 水里鄉:Shuili 信義鄉:Xinyi 仁愛鄉:Ren'ai" },
  { code: "P", en: "Yunlin County", aliases: ["Yunlin", "Yunlin County"], d: "斗六市:Douliu 斗南鎮:Dounan 虎尾鎮:Huwei 西螺鎮:Xiluo 土庫鎮:Tuku 北港鎮:Beigang 古坑鄉:Gukeng 大埤鄉:Dapi 莿桐鄉:Citong 林內鄉:Linnei 二崙鄉:Erlun 崙背鄉:Lunbei 麥寮鄉:Mailiao 東勢鄉:Dongshi 褒忠鄉:Baozhong 臺西鄉:Taixi 元長鄉:Yuanchang 四湖鄉:Sihu 口湖鄉:Kouhu 水林鄉:Shuilin" },
  { code: "I", en: "Chiayi City", aliases: ["Chiayi", "Chiayi City", "Jiayi", "Jiayi City"], d: "東區:East 西區:West" },
  { code: "Q", en: "Chiayi County", aliases: ["Chiayi", "Chiayi County", "Jiayi", "Jiayi County"], d: "太保市:Taibao 朴子市:Puzi 布袋鎮:Budai 大林鎮:Dalin 民雄鄉:Minxiong 溪口鄉:Xikou 新港鄉:Xingang 六腳鄉:Liujiao 東石鄉:Dongshi 義竹鄉:Yizhu 鹿草鄉:Lucao 水上鄉:Shuishang 中埔鄉:Zhongpu 竹崎鄉:Zhuqi 梅山鄉:Meishan 番路鄉:Fanlu 大埔鄉:Dapu 阿里山鄉:Alishan" },
  { code: "T", en: "Pingtung County", aliases: ["Pingtung", "Pingtung County"], d: "屏東市:Pingtung 潮州鎮:Chaozhou 東港鎮:Donggang 恆春鎮:Hengchun 萬丹鄉:Wandan 長治鄉:Changzhi 麟洛鄉:Linluo 九如鄉:Jiuru 里港鄉:Ligang 鹽埔鄉:Yanpu 高樹鄉:Gaoshu 萬巒鄉:Wanluan 內埔鄉:Neipu 竹田鄉:Zhutian 新埤鄉:Xinpi 枋寮鄉:Fangliao 新園鄉:Xinyuan 崁頂鄉:Kanding 林邊鄉:Linbian 南州鄉:Nanzhou 佳冬鄉:Jiadong 琉球鄉:Liuqiu 車城鄉:Checheng 滿州鄉:Manzhou 枋山鄉:Fangshan 三地門鄉:Sandimen 霧臺鄉:Wutai 瑪家鄉:Majia 泰武鄉:Taiwu 來義鄉:Laiyi 春日鄉:Chunri 獅子鄉:Shizi 牡丹鄉:Mudan" },
  { code: "G", en: "Yilan County", aliases: ["Yilan", "Yilan County", "Ilan"], d: "宜蘭市:Yilan 羅東鎮:Luodong 蘇澳鎮:Su'ao/Suao 頭城鎮:Toucheng 礁溪鄉:Jiaoxi 壯圍鄉:Zhuangwei 員山鄉:Yuanshan 冬山鄉:Dongshan 五結鄉:Wujie 三星鄉:Sanxing 大同鄉:Datong 南澳鄉:Nan'ao/Nanao" },
  { code: "U", en: "Hualien County", aliases: ["Hualien", "Hualien County"], d: "花蓮市:Hualien 鳳林鎮:Fenglin 玉里鎮:Yuli 新城鄉:Xincheng 吉安鄉:Ji'an/Jian 壽豐鄉:Shoufeng 光復鄉:Guangfu 豐濱鄉:Fengbin 瑞穗鄉:Ruisui 富里鄉:Fuli 秀林鄉:Xiulin 萬榮鄉:Wanrong 卓溪鄉:Zhuoxi" },
  { code: "V", en: "Taitung County", aliases: ["Taitung", "Taitung County"], d: "臺東市:Taitung 成功鎮:Chenggong 關山鎮:Guanshan 卑南鄉:Beinan 鹿野鄉:Luye 池上鄉:Chishang 東河鄉:Donghe 長濱鄉:Changbin 太麻里鄉:Taimali 大武鄉:Dawu 綠島鄉:Lüdao/Ludao 海端鄉:Haiduan 延平鄉:Yanping 金峰鄉:Jinfeng 達仁鄉:Daren 蘭嶼鄉:Lanyu" },
  { code: "X", en: "Penghu County", aliases: ["Penghu", "Penghu County", "Pescadores"], d: "馬公市:Magong 湖西鄉:Huxi 白沙鄉:Baisha 西嶼鄉:Xiyu 望安鄉:Wang'an 七美鄉:Qimei" },
  { code: "W", en: "Kinmen County", aliases: ["Kinmen", "Kinmen County", "Quemoy"], d: "金城鎮:Jincheng 金湖鎮:Jinhu 金沙鎮:Jinsha 金寧鄉:Jinning 烈嶼鄉:Lieyu 烏坵鄉:Wuqiu" },
  { code: "Z", en: "Lienchiang County", aliases: ["Lienchiang", "Lienchiang County", "Matsu"], d: "南竿鄉:Nangan 北竿鄉:Beigan 莒光鄉:Juguang 東引鄉:Dongyin" },
];

// ---------- folding ----------

/** Lower case, accents and punctuation removed, 台 written as 臺: "Da'an" -> "daan", "台北市" -> "臺北市". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/台/g, "臺")
    .replace(/[^a-z0-9一-鿿]+/g, "");
}

const NOISE = /\b(?:district|dist|township|town|ward|borough|urban|rural|taiwan|roc|in|of|the)\b/g;
const ZH_SUFFIX = /[區市鎮鄉縣]$/;
const stem = (zh: string) => zh.replace(ZH_SUFFIX, "");
const hasZh = (s: string) => /[一-鿿]/.test(s);

// ---------- the index ----------

export interface District {
  zh: string; // 大安區
  en: string; // Da'an District
  names: string[]; // folded: Chinese full and stem, English spellings
}
export interface City {
  code: string;
  zh: string;
  en: string;
  aliases: string[]; // folded
  districts: District[];
}
export interface Place {
  city: City;
  district: District | null;
  /** The library area key: "A" for a city or county, "A|大安區" for a district. */
  key: string;
  /** "Da'an District, Taipei City (大安區, 臺北市)" */
  label: string;
}

const KIND_EN: Record<string, string> = { 區: "District", 市: "City", 鎮: "Town", 鄉: "Township" };

function buildCities(): City[] {
  return CITIES.map((c) => {
    const zh = CITY_BY_CODE[c.code];
    const districts: District[] = c.d.split(" ").map((entry) => {
      const [dzh, spell] = entry.split(":");
      const spellings = spell.split("/").map((x) => x.replace(/_/g, " "));
      const kind = KIND_EN[dzh.slice(-1)] ?? "District";
      return {
        zh: dzh,
        en: `${spellings[0]} ${kind}`,
        names: [...new Set([fold(dzh), fold(stem(dzh)), ...spellings.map(fold)])],
      };
    });
    const aliases = [...new Set([...c.aliases.map(fold), fold(zh), fold(stem(zh))])];
    return { code: c.code, zh, en: c.en, aliases, districts };
  });
}

export const TAIWAN_CITIES: City[] = buildCities();
export const cityByCode = (code: string) => TAIWAN_CITIES.find((c) => c.code === code);

export const cityKey = (c: City) => c.code;
export const districtKey = (c: City, d: District) => `${c.code}|${d.zh}`;
export const cityLabel = (c: City) => `${c.en} (${c.zh})`;
export const placeLabel = (c: City, d: District | null) => (d ? `${d.en}, ${c.en} (${d.zh}, ${c.zh})` : cityLabel(c));

function place(city: City, district: District | null): Place {
  return { city, district, key: district ? districtKey(city, district) : cityKey(city), label: placeLabel(city, district) };
}

/** A district the register has but our table does not know in English: still reachable by its Chinese name. */
export function districtFromName(zh: string): District {
  return { zh, en: zh, names: [fold(zh), fold(stem(zh))] };
}

/** Add districts found in the library (area keys "A|大安區") that the table lacks, so every district with data answers in Chinese. */
export function indexWithLibrary(areas: string[]): City[] {
  const extra = new Map<string, Set<string>>();
  for (const a of areas) {
    const [code, dz] = a.split("|");
    if (!dz) continue;
    const city = cityByCode(code);
    if (city && !city.districts.some((d) => d.zh === dz)) {
      const s = extra.get(code) ?? new Set<string>();
      s.add(dz);
      extra.set(code, s);
    }
  }
  if (!extra.size) return TAIWAN_CITIES;
  return TAIWAN_CITIES.map((c) => (extra.has(c.code) ? { ...c, districts: [...c.districts, ...[...extra.get(c.code)!].map(districtFromName)] } : c));
}

// ---------- matching ----------

export const NATIONAL_WORDS = new Set(["taiwan", "tw", "roc", "republicofchina", "national", "nationwide", "all", "wholecountry", "country", "臺灣", "全臺", "全國", "全台灣", "全臺灣"].map(fold));

export type Lookup =
  | { kind: "national" }
  | { kind: "found"; place: Place }
  | { kind: "ambiguous"; options: Place[] }
  | { kind: "city_only_district_missing"; city: City; asked: string }
  | { kind: "none" };

function pickDistrict(city: City, text: string): District | null {
  const f = fold(text.replace(NOISE, " "));
  if (!f) return null;
  const f2 = f.replace(/^(city|county)|(city|county)$/g, "");
  return city.districts.find((d) => d.names.includes(f) || (f2 && d.names.includes(f2))) ?? null;
}

/** Split "cityPart + rest" using a city alias at the start or the end of the (folded) text; returns each way it can be cut. */
function citySplits(folded: string, cities: City[]): { city: City; rest: string }[] {
  const out: { city: City; rest: string; len: number }[] = [];
  for (const c of cities) {
    for (const a of c.aliases) {
      if (!a) continue;
      if (folded.startsWith(a)) out.push({ city: c, rest: folded.slice(a.length), len: a.length });
      if (folded.endsWith(a) && folded.length > a.length) out.push({ city: c, rest: folded.slice(0, folded.length - a.length), len: a.length });
    }
  }
  return out.sort((x, y) => y.len - x.len);
}

/** Match what the caller typed to a city, county or district. `cities` is TAIWAN_CITIES, or indexWithLibrary(...). */
export function findPlace(input: string, cities: City[] = TAIWAN_CITIES): Lookup {
  const raw = input.replace(/[()（）]/g, ",").trim();
  if (!raw || NATIONAL_WORDS.has(fold(raw))) return { kind: "national" };

  const clean = raw.toLowerCase().replace(NOISE, " ");
  const parts = clean.split(/[,，、;；/]+/).map((p) => p.trim()).filter(Boolean);
  const whole = fold(clean.replace(/[,，、;；/]+/g, " "));
  const justCity = (rest: string) => !rest.replace(/city|county/g, "");

  // A district named together with its city: "Da'an, Taipei", "Taipei Da'an District", "臺北市大安區", "台北 大安".
  const found = new Map<string, Place>();
  for (const sp of citySplits(whole, cities)) {
    if (justCity(sp.rest)) continue;
    const d = pickDistrict(sp.city, sp.rest);
    if (d) found.set(districtKey(sp.city, d), place(sp.city, d));
  }
  if (parts.length > 1) {
    for (let i = 0; i < parts.length; i++) {
      for (const c of cities) {
        if (!c.aliases.includes(fold(parts[i]))) continue;
        for (let j = 0; j < parts.length; j++) {
          const d = j === i ? null : pickDistrict(c, parts[j]);
          if (d) found.set(districtKey(c, d), place(c, d));
        }
      }
    }
  }
  if (found.size === 1) return { kind: "found", place: [...found.values()][0] };
  if (found.size > 1) return { kind: "ambiguous", options: [...found.values()] };

  // A city or county on its own. "Hsinchu" and "Chiayi" name both a city and a county: ambiguous until "City" or "County" is added.
  const bare = whole.replace(/^(city|county)|(city|county)$/g, "");
  let cityHits = cities.filter((c) => c.aliases.includes(whole));
  if (!cityHits.length && bare) cityHits = cities.filter((c) => c.aliases.includes(bare));
  if (cityHits.length === 1) return { kind: "found", place: place(cityHits[0], null) };
  if (cityHits.length > 1) return { kind: "ambiguous", options: cityHits.map((c) => place(c, null)) };

  // A district name on its own, anywhere in Taiwan.
  const districtHits = cities.flatMap((c) => {
    const d = pickDistrict(c, whole);
    return d ? [place(c, d)] : [];
  });
  if (districtHits.length === 1) return { kind: "found", place: districtHits[0] };
  if (districtHits.length > 1) return { kind: "ambiguous", options: districtHits };

  // A known city with a district we cannot find.
  const lead = citySplits(whole, cities).find((s) => !justCity(s.rest));
  if (lead) return { kind: "city_only_district_missing", city: lead.city, asked: lead.rest };
  return { kind: "none" };
}

/** Plain-words list of the districts of a city, for error messages. */
export function districtList(city: City, max = 40): string {
  return city.districts.slice(0, max).map((d) => (d.en === d.zh ? d.zh : `${d.zh} ${d.en.replace(/ (District|City|Town|Township)$/, "")}`)).join(", ");
}
