import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");
const historyDir = path.join(dataDir, "history");
const offline = process.argv.includes("--offline");
const config = await loadConfig();
const days = normalizeDays(process.env.SNAPSHOT_DAYS || process.argv.find(arg => arg.startsWith("--days="))?.split("=")[1] || 2);

const trendCatalog = [
  ["ai-infrastructure", "AI 基礎設施 / AI infrastructure", ["ai", "gpu", "data center", "cloud", "inference", "training", "server"]],
  ["partnership", "合作夥伴 / Partnership", ["partner", "deal", "customer", "collaboration", "supplier", "ecosystem", "alliance"]],
  ["conference", "活動 / Conference signal", ["computex", "conference", "keynote", "gtc", "summit", "forum", "expo", "transcript", "video"]],
  ["chips", "半導體平台 / Semiconductor platform", ["chip", "semiconductor", "cpu", "gpu", "foundry", "tsmc", "packaging", "memory"]],
  ["robotics", "實體 AI / Robotics", ["robot", "robotics", "humanoid", "autonomous", "factory"]],
  ["market", "市場訊號 / Market signal", ["stock", "shares", "earnings", "revenue", "forecast", "guidance"]]
];

const knownPartners = [
  "NVIDIA", "Nvidia", "AMD", "OpenAI", "Anthropic", "Microsoft", "Oracle", "Google",
  "Amazon", "AWS", "Meta", "Tesla", "TSMC", "Foxconn", "Hon Hai", "MediaTek", "MTK",
  "Dell", "Dell Technologies", "HP", "Lenovo", "ASUS", "Acer", "Quanta", "Wistron", "SoftBank",
  "Arm", "Marvell", "Marvell Technology", "Samsung", "Samsung Electronics", "SK hynix", "SK Group", "Hyundai",
  "Hyundai Motor", "LG", "Intel", "Broadcom", "Cisco", "SpaceX", "Unitree",
  "Figure AI", "Naver", "Kakao", "Oracle Cloud", "CoreWeave"
];

const partnerSearchHints = [
  "Dell", "Dell Technologies", "MediaTek", "MTK", "HP", "Lenovo", "Microsoft",
  "Foxconn", "Hon Hai", "TSMC", "Quanta", "Wistron", "ASUS", "Acer", "CoreWeave", "Oracle",
  "AMD", "OpenAI", "Anthropic", "Amazon", "AWS", "Google", "Meta", "Tesla", "SoftBank", "Marvell", "Marvell Technology",
  "Arm", "Samsung", "SK hynix", "Intel", "Broadcom", "Cisco", "SpaceX", "Unitree", "Figure AI"
];

const marketSymbols = new Map([
  ["nvidia", "NVDA"],
  ["amd", "AMD"],
  ["microsoft", "MSFT"],
  ["oracle", "ORCL"],
  ["google", "GOOGL"],
  ["amazon", "AMZN"],
  ["aws", "AMZN"],
  ["meta", "META"],
  ["tesla", "TSLA"],
  ["tsmc", "2330.TW"],
  ["foxconn", "2317.TW"],
  ["hon hai", "2317.TW"],
  ["mediatek", "2454.TW"],
  ["mtk", "2454.TW"],
  ["dell", "DELL"],
  ["hp", "HPQ"],
  ["lenovo", "0992.HK"],
  ["asus", "2357.TW"],
  ["acer", "2353.TW"],
  ["quanta", "2382.TW"],
  ["wistron", "3231.TW"],
  ["softbank", "9984.T"],
  ["arm", "ARM"],
  ["marvell", "MRVL"],
  ["marvell technology", "MRVL"],
  ["samsung", "005930.KS"],
  ["samsung electronics", "005930.KS"],
  ["sk hynix", "000660.KS"],
  ["hyundai", "005380.KS"],
  ["hyundai motor", "005380.KS"],
  ["lg", "003550.KS"],
  ["intel", "INTC"],
  ["broadcom", "AVGO"],
  ["cisco", "CSCO"],
  ["coreweave", "CRWV"]
]);

const mediaAndNoise = new Set([
  "CNBC", "Reuters", "Bloomberg", "Business Insider", "The Korea Herald",
  "Korea Herald", "NVIDIA Blog", "Yahoo Finance", "AP News", "BBC", "CNN",
  "Fortune", "Forbes", "MarketWatch", "WSJ", "The Wall Street Journal", "MSN",
  "Crypto Briefing", "Benzinga", "Motley Fool", "Investopedia", "Seeking Alpha",
  "Google News", "YouTube", "LinkedIn", "GitHub", "AI Magazine", "International Business Times",
  "HarianBasis.co", "Digital Foundry", "Quiver Quantitative", "Data Centre Magazine", "Manufacturing Digital",
  "Sahm", "Trefis", "Seoul", "South Korea",
  "Korea", "China", "US", "USA", "CEO", "AI", "GPU", "CPU", "PC"
]);

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(historyDir, { recursive: true });

const generatedAt = formatTaipei(new Date());
const period = `${dateOnly(addDays(new Date(), -(days - 1)))} ~ ${dateOnly(new Date())}`;
const previousPartners = await loadPreviousPartners();
const celebrities = [];

for (const celebrity of config.celebrities) {
  const articles = offline ? [] : await collectArticles(celebrity).catch(error => {
    console.warn(`${celebrity.name}: ${error.message}`);
    return [];
  });
  celebrities.push(buildCelebritySnapshot(celebrity, articles, previousPartners));
}

if (!offline) {
  await attachMarketData(celebrities);
}

const sourceCount = celebrities.reduce((sum, item) => sum + item.articles.length, 0);
const snapshot = {
  generatedAt,
  period,
  lookbackDays: days,
  mode: sourceCount ? "Daily Live Snapshot" : "Fallback Snapshot",
  sourceStatus: sourceCount ? "Live public sources collected successfully." : "No live source was available. Fallback data is shown until the next successful update.",
  celebrities,
  sources: celebrities.flatMap(item => item.articles).slice(0, 80).map(article => ({
    title: article.title,
    url: article.url,
    source: article.source,
    publishedAt: article.publishedAt,
    sourceType: article.sourceType,
    searchQuery: article.searchQuery
  }))
};

await fs.writeFile(path.join(dataDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
await fs.writeFile(path.join(historyDir, `${dateOnly(new Date())}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Snapshot written for ${period} with ${celebrities.length} celebrities.`);

async function collectArticles(celebrity) {
  const requests = buildSearchRequests(celebrity);
  const batches = await Promise.allSettled(requests.map(fetchGoogleNews));
  const groups = batches
    .filter(result => result.status === "fulfilled")
    .map(result => result.value.slice(0, 5))
    .filter(group => group.length);
  return dedupe(roundRobin(groups)).slice(0, 120);
}

function buildSearchRequests(celebrity) {
  const company = celebrity.company && celebrity.company !== "N/A" ? celebrity.company : "";
  const aliases = unique([celebrity.name, celebrity.localName, company, ...(celebrity.aliases || [])].filter(Boolean));
  const identity = aliases.slice(0, 3).map(term => quoteIfNeeded(term)).join(" OR ") || quoteIfNeeded(celebrity.name);
  const core = company ? `${quoteIfNeeded(celebrity.name)} ${quoteIfNeeded(company)}` : quoteIfNeeded(celebrity.name);
  const requests = [];
  const push = (query, sourceType) => {
    if (query && !requests.some(item => item.query.toLowerCase() === query.toLowerCase())) {
      requests.push({ query, sourceType });
    }
  };

  push(core, "News");
  push(`${identity} news`, "News");
  push(`${identity} partner OR collaboration OR supplier OR ecosystem`, "Partner text");
  push(`${identity} investment OR investor OR funding OR stake OR acquisition`, "Investment");
  push(`${identity} strategic partner OR partnership OR collaboration OR customer`, "Partner text");
  push(`${identity} COMPUTEX OR conference OR keynote OR GTC`, "Conference");
  push(`${identity} COMPUTEX Dell OR "Dell Technologies"`, "Conference");
  push(`${identity} COMPUTEX MediaTek OR MTK`, "Conference");
  push(`${identity} keynote video OR interview OR transcript`, "Video / transcript");

  for (const partner of allPartnerHints()) {
    push(`${identity} ${quoteIfNeeded(partner)}`, "Partner text");
    push(`${identity} ${quoteIfNeeded(partner)} investment OR stake OR funding`, "Investment");
  }
  for (const partner of allPartnerHints()) {
    push(`${identity} COMPUTEX ${quoteIfNeeded(partner)}`, "Conference");
  }

  return requests;
}

async function fetchGoogleNews({ query, sourceType }) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}%20when:${days}d&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetch(url, { headers: { "user-agent": "janus-web-celebrity-tracker/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const text = await response.text();
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => {
    const item = match[1];
    return {
      title: decodeXml(xml(item, "title")),
      url: decodeXml(xml(item, "link")),
      source: decodeXml(xml(item, "source")) || "Google News",
      publishedAt: toIso(xml(item, "pubDate")),
      snippet: stripHtml(decodeXml(xml(item, "description"))),
      sourceType,
      searchQuery: query
    };
  }).filter(article => article.title && article.url);
}

function buildCelebritySnapshot(celebrity, articles, previousPartners) {
  const trends = buildTrends(articles);
  const entities = articles.length ? buildPartners(celebrity, articles, previousPartners) : fallbackPartners(celebrity);
  const primaryCompanySignals = entities.filter(row => row.type === "Tracked company");
  const partners = entities.filter(row => row.type !== "Tracked company");
  return {
    id: celebrity.id,
    name: celebrity.localName ? `${celebrity.name} / ${celebrity.localName}` : celebrity.name,
    company: celebrity.company || "N/A",
    primaryCompanySignals,
    summary: articles.length
      ? `${celebrity.name} / ${celebrity.company || "N/A"} 在本次期間抓到 ${articles.length} 則公開來源。最高分趨勢是 ${trends[0]?.title || "general news"}；外部關聯夥伴 ${partners.length} 個。`
      : "Fallback demo data is loaded. The live updater will replace this with fresh public-news signals each day.",
    metrics: {
      articles: articles.length,
      sources: new Set(articles.map(article => article.source)).size,
      partners: partners.length,
      trends: trends.length
    },
    trends,
    partners,
    articles
  };
}

function buildTrends(articles) {
  const trends = trendCatalog.map(([id, title, keywords]) => {
    const hits = articles.filter(article => keywords.some(keyword => `${article.title} ${article.snippet}`.toLowerCase().includes(keyword)));
    return {
      id,
      title,
      score: Math.min(99, 55 + hits.length * 8 + new Set(hits.map(hit => hit.source)).size * 4),
      summary: hits.length ? `今日公開來源中有 ${hits.length} 則相關訊號。` : "今日尚未抓到明確訊號。",
      technology: keywords.slice(0, 5),
      impact: hits.length ? "可用來觀察名人敘事、合作、產品與市場反應是否同步升溫。" : "若連續多日沒有訊號，可視為短期熱度降低。",
      sources: hits.slice(0, 4).map(hit => hit.title)
    };
  }).filter(trend => trend.score > 55);
  return trends.length ? trends.sort((a, b) => b.score - a.score).slice(0, 6) : fallbackTrends();
}

function buildPartners(celebrity, articles, previousPartners) {
  const map = new Map();
  for (const article of articles) {
    for (const partner of extractPartners(celebrity, `${article.title} ${article.snippet}`)) {
      const key = normalizePartner(partner).toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          partner: normalizePartner(partner),
          type: partner.toLowerCase() === celebrity.company.toLowerCase() ? "Tracked company" : "Detected organization",
          cooperation: "",
          mentions: 0,
          occasions: [],
          evidenceTexts: [],
          first: !previousPartners.has(key),
          sourceTypes: new Set(),
          trend: matchTrend(article)
        });
      }
      const row = map.get(key);
      row.mentions += 1;
      row.occasions.push(`${article.source}: ${article.title}`);
      row.evidenceTexts.push(`${article.title} ${article.snippet || ""}`);
      row.sourceTypes.add(article.sourceType || "News");
    }
  }
  return [...map.values()]
    .map(row => ({
      ...row,
      cooperation: summarizeCooperation(row),
      sourceTypes: [...row.sourceTypes],
      occasions: row.occasions.slice(0, 3),
      evidenceTexts: undefined
    }))
    .sort((a, b) => b.mentions - a.mentions || a.partner.localeCompare(b.partner))
    .slice(0, 60);
}

function summarizeCooperation(row) {
  const text = row.evidenceTexts.join(" ").toLowerCase();
  const keywords = [];
  const add = (label, pattern) => {
    if (pattern.test(text) && !keywords.includes(label)) keywords.push(label);
  };

  add("RTX Spark", /\brtx spark\b/i);
  add("AI PC / Windows PC", /\b(ai pc|windows pc|personal computer|laptop|notebook)\b/i);
  add("AI factory", /\bai factory\b/i);
  add("Vera Rubin / NVL72", /\b(vera rubin|nvl72)\b/i);
  add("chip / CPU / GPU", /\b(chip|cpu|gpu|superchip|processor)\b/i);
  add("data center / cloud", /\b(data center|datacenter|cloud|server)\b/i);
  add("manufacturing / fab", /\b(fab|foundry|manufactur|production|semiconductor design)\b/i);
  add("investment / stake", /\b(invest|investment|stake|funding|acquisition|stock|shares)\b/i);
  add("strategic partnership", /\b(partner|partnership|collaborat|alliance|customer|supplier|ecosystem)\b/i);
  add("COMPUTEX / keynote", /\b(computex|keynote|gtc|conference|summit|expo)\b/i);

  const short = keywords.slice(0, 4);
  const summary = short.length ? short.join("、") : "共同出現訊號";
  return isAutoVerified(row, text) ? summary : `待驗證：${summary}`;
}

function isAutoVerified(row, text) {
  const partner = escapeRegExp(row.partner.toLowerCase());
  const hasExplicitRelation = /\b(collaborat(?:e|es|ed|ion)|partner(?:s|ed|ship)?|powered by|built with|teams? with|alliance|customer|supplier|invest(?:s|ed|ment)?|funding|stake|acquisition|deploy(?:s|ed|ment)?|adopt(?:s|ed|ion)?|commit(?:s|ted)?|integrat(?:e|es|ed|ion))\b/i.test(text);
  const hasPartnerNearSignal = new RegExp(`${partner}.{0,90}\\b(nvidia|rtx spark|ai pc|windows pc|vera rubin|nvl72|computex|collaborat|partner|invest|stake|powered by)\\b|\\b(nvidia|rtx spark|ai pc|windows pc|vera rubin|nvl72|computex|collaborat|partner|invest|stake|powered by)\\b.{0,90}${partner}`, "i").test(text);
  const hasTrustedSource = row.sourceTypes.has?.("Investment") || row.sourceTypes.has?.("Conference") || row.sourceTypes.has?.("Partner text");
  return hasExplicitRelation && (hasPartnerNearSignal || hasTrustedSource);
}

async function attachMarketData(celebrities) {
  const names = unique(celebrities.flatMap(celebrity => [
    celebrity.company,
    ...(celebrity.primaryCompanySignals || []).map(row => row.partner),
    ...(celebrity.partners || []).map(row => row.partner)
  ].filter(Boolean)));
  const rows = await Promise.allSettled(names.map(fetchMarketData));
  const data = new Map();
  rows.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) data.set(names[index].toLowerCase(), result.value);
  });

  for (const celebrity of celebrities) {
    for (const row of [...(celebrity.primaryCompanySignals || []), ...(celebrity.partners || [])]) {
      row.market = data.get(row.partner.toLowerCase()) || unavailableMarketData(row.partner);
    }
  }
}

async function fetchMarketData(name) {
  const symbol = marketSymbols.get(String(name).toLowerCase());
  if (!symbol) return unavailableMarketData(name);
  const [quote, eps] = await Promise.all([
    fetchQuote(symbol).catch(() => null),
    fetchAnnualEps(symbol).catch(() => ({}))
  ]);
  return {
    partner: name,
    symbol,
    price: quote?.price ?? null,
    currency: quote?.currency || eps.currency || "",
    quoteTime: quote?.quoteTime || "",
    eps2025: eps["2025"] ?? null,
    eps2026: eps["2026"] ?? null,
    status: quote ? "ok" : "unavailable"
  };
}

async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`quote ${response.status}`);
  const body = await response.json();
  const result = body.chart?.result?.[0];
  const meta = result?.meta || {};
  const price = meta.regularMarketPrice ?? result?.indicators?.quote?.[0]?.close?.filter(Number.isFinite).at(-1);
  return {
    price: Number.isFinite(price) ? price : null,
    currency: meta.currency || "",
    quoteTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : ""
  };
}

async function fetchAnnualEps(symbol) {
  const period1 = Math.floor(Date.UTC(2023, 0, 1) / 1000);
  const period2 = Math.floor(Date.UTC(2027, 11, 31) / 1000);
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=annualDilutedEPS&period1=${period1}&period2=${period2}`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`eps ${response.status}`);
  const body = await response.json();
  const rows = body.timeseries?.result?.[0]?.annualDilutedEPS || [];
  const eps = {};
  for (const row of rows) {
    const year = String(new Date(row.asOfDate).getUTCFullYear());
    if (year === "2025" || year === "2026") {
      eps[year] = row.reportedValue?.raw ?? null;
      eps.currency ||= row.currencyCode || "";
    }
  }
  return eps;
}

function unavailableMarketData(name) {
  return {
    partner: name,
    symbol: "",
    price: null,
    currency: "",
    quoteTime: "",
    eps2025: null,
    eps2026: null,
    status: "unavailable"
  };
}

function extractPartners(celebrity, text) {
  const found = new Set(celebrity.company && celebrity.company !== "N/A" ? [celebrity.company] : []);
  for (const name of knownPartners) {
    if (new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(name)}([^A-Za-z0-9]|$)`, "i").test(text)) {
      found.add(name);
    }
  }

  const suffixPattern = /\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3})\s+(Inc|Corp|Corporation|Group|Holdings|Technologies|Systems|Electronics|Motor|Semiconductor|Robotics|Foundry)\b/g;
  for (const match of text.matchAll(suffixPattern)) {
    found.add(`${match[1]} ${match[2]}`);
  }

  const phrasePattern = /\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){1,3}\b/g;
  for (const match of text.matchAll(phrasePattern)) {
    const phrase = match[0].trim();
    if (looksLikeOrganization(phrase, celebrity)) found.add(phrase);
  }

  return [...found].map(normalizePartner).filter(Boolean).filter(name => !isNoisePartner(name, celebrity)).slice(0, 10);
}

function looksLikeOrganization(phrase, celebrity) {
  if (phrase.includes(celebrity.name)) return false;
  if (phrase.split(/\s+/).length > 4) return false;
  if (/\b(CEO|CFO|CTO|Investors|Says|Said|Just|This|Up|Down|Why|How|What|Which|After|Before|During|Called|Designing|Compares|Projects|Massive|Record|Highs|Amid|Into|With)\b/i.test(phrase)) return false;
  return /(?:^|\s)(Group|Electronics|Motor|Semiconductor|Systems|Technologies|Labs|Robotics|Capital|Foundry|Holdings)$/i.test(phrase);
}

function normalizePartner(name) {
  return name
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s+\|\s+.*$/, "")
    .replace(/\s+(Inc|Corp|Corporation|Co|Ltd|LLC|PLC)\.?$/i, "")
    .replace(/^Nvidia$/i, "NVIDIA")
    .replace(/^Amd$/i, "AMD")
    .replace(/^Mtk$/i, "MediaTek")
    .replace(/^Dell Technologies$/i, "Dell")
    .replace(/^Marvell Technology$/i, "Marvell")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoisePartner(name, celebrity) {
  if (!name || name.length < 2) return true;
  if (mediaAndNoise.has(name)) return true;
  if (/^(Into|With|For|From|To|At|By|And)\b/i.test(name)) return true;
  if (/\b(with|into action with)\b/i.test(name)) return true;
  for (const noise of mediaAndNoise) {
    if (noise.length > 4 && name.toLowerCase().includes(noise.toLowerCase())) return true;
  }
  if (name === celebrity.name || name === celebrity.localName || name.includes(celebrity.name)) return true;
  if (celebrity.company && name.toLowerCase().includes(celebrity.company.toLowerCase()) && name !== celebrity.company) return true;
  if (/[.:]/.test(name)) return true;
  if (/^(The|This|That|New|Latest|Breaking|Here|Why|How|What|Which|As|After|Before|During|CEO|CNBC|MSN|Reuters|Crypto Briefing|AI Magazine|International Business Times)\b/i.test(name)) return true;
  if (/\b(CEO|Says|Said|Just|Investors|Record|Highs|Amid|Massive|Projects|Compares)\b/i.test(name)) return true;
  return false;
}

function fallbackTrends() {
  return [
    { id: "ai-infrastructure", title: "AI infrastructure", score: 82, summary: "Daily updater tracks AI infrastructure signals.", technology: ["AI", "GPU", "cloud"], impact: "Placeholder until live sources are available.", sources: [] },
    { id: "partnership", title: "Partnership", score: 78, summary: "Partner extraction compares daily signals against history.", technology: ["entity detection", "history"], impact: "First mention becomes stronger as history grows.", sources: [] },
    { id: "market", title: "Market signal", score: 72, summary: "Market reactions are grouped separately.", technology: ["earnings", "revenue", "stock"], impact: "Production can later attach market-data connectors.", sources: [] }
  ];
}

function fallbackPartners(celebrity) {
  const fallback = [celebrity.company, "OpenAI", "TSMC"].filter(Boolean);
  return fallback.map(partner => ({
    partner,
    type: partner === celebrity.company ? "Tracked company" : "Known ecosystem entity",
    cooperation: "Tracked when mentioned in public sources.",
    mentions: 0,
    occasions: [],
    first: false,
    sourceTypes: ["Fallback"],
    trend: "General news"
  }));
}

function matchTrend(article) {
  const text = `${article.title} ${article.snippet}`.toLowerCase();
  return trendCatalog.find(([, , keywords]) => keywords.some(keyword => text.includes(keyword)))?.[1] || "General news";
}

async function loadPreviousPartners() {
  const set = new Set();
  try {
    const files = await fs.readdir(historyDir);
    for (const file of files.filter(name => name.endsWith(".json")).slice(-30)) {
      const historical = JSON.parse(await fs.readFile(path.join(historyDir, file), "utf8"));
      for (const celebrity of historical.celebrities || []) {
        for (const partner of celebrity.primaryCompanySignals || []) set.add(String(partner.partner).toLowerCase());
        for (const partner of celebrity.partners || []) set.add(String(partner.partner).toLowerCase());
      }
    }
  } catch {}
  return set;
}

function dedupe(articles) {
  const seen = new Set();
  return articles.filter(article => {
    const key = article.url.split("?")[0] || article.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function xml(item, tag) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "") : "";
}

function decodeXml(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}

function stripHtml(value = "") {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function toIso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatTaipei(date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) + " Asia/Taipei";
}

function dateOnly(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(date);
}

function addDays(date, count) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + count);
  return copy;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteIfNeeded(value) {
  const text = String(value || "").trim();
  return /\s/.test(text) || /[^\x00-\x7F]/.test(text) ? `"${text.replace(/"/g, "")}"` : text;
}

function unique(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = String(value).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allPartnerHints() {
  return unique([...partnerSearchHints, ...knownPartners])
    .map(normalizePartner)
    .filter(value => value && value !== "N/A" && !mediaAndNoise.has(value));
}

function roundRobin(groups) {
  const rows = [];
  const max = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < max; index += 1) {
    for (const group of groups) {
      if (group[index]) rows.push(group[index]);
    }
  }
  return rows;
}

async function loadConfig() {
  if (process.env.SNAPSHOT_CELEBRITIES) {
    const celebrities = JSON.parse(process.env.SNAPSHOT_CELEBRITIES).map(normalizeCelebrity).filter(Boolean);
    if (celebrities.length) return { celebrities };
  }
  return JSON.parse(await fs.readFile(path.join(root, "config", "celebrities.json"), "utf8"));
}

function normalizeCelebrity(input) {
  const name = String(input.name || "").trim();
  if (!name) return null;
  const company = String(input.company || "").trim();
  const localName = String(input.localName || "").trim();
  const aliases = [...new Set([name, localName, company ? `${company} ${name}` : "", ...(input.aliases || [])].filter(Boolean))];
  return {
    id: slugify(`${name}-${company || "public-figure"}`),
    name,
    localName,
    company: company || "N/A",
    aliases
  };
}

function normalizeDays(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(30, Math.max(1, parsed));
}

function slugify(value) {
  const ascii = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return ascii || `person-${Buffer.from(value).toString("hex").slice(0, 12)}`;
}
