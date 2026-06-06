import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");
const historyDir = path.join(dataDir, "history");
const config = JSON.parse(await fs.readFile(path.join(root, "config", "celebrities.json"), "utf8"));
const offline = process.argv.includes("--offline");
const days = Number(process.env.SNAPSHOT_DAYS || 2);

const trendCatalog = [
  ["ai-infrastructure", "AI 基礎設施 / AI infrastructure", ["ai", "gpu", "data center", "cloud", "inference", "training", "server"]],
  ["partnership", "合作夥伴 / Partnership", ["partner", "deal", "customer", "collaboration", "supplier", "ecosystem", "alliance"]],
  ["chips", "半導體平台 / Semiconductor platform", ["chip", "semiconductor", "cpu", "gpu", "foundry", "tsmc", "packaging", "memory"]],
  ["robotics", "實體 AI / Robotics", ["robot", "robotics", "humanoid", "autonomous", "factory"]],
  ["market", "市場訊號 / Market signal", ["stock", "shares", "earnings", "revenue", "forecast", "guidance"]]
];

const knownPartners = [
  "NVIDIA", "Nvidia", "AMD", "OpenAI", "Anthropic", "Microsoft", "Oracle", "Google",
  "Amazon", "AWS", "Meta", "Tesla", "TSMC", "Foxconn", "Hon Hai", "MediaTek",
  "Dell", "HP", "Lenovo", "ASUS", "Acer", "Quanta", "Wistron", "SoftBank",
  "Arm", "Samsung", "Samsung Electronics", "SK hynix", "SK Group", "Hyundai",
  "Hyundai Motor", "LG", "Intel", "Broadcom", "Cisco", "SpaceX", "Unitree",
  "Figure AI", "Naver", "Kakao", "Oracle Cloud", "CoreWeave"
];

const mediaAndNoise = new Set([
  "CNBC", "Reuters", "Bloomberg", "Business Insider", "The Korea Herald",
  "Korea Herald", "NVIDIA Blog", "Yahoo Finance", "AP News", "BBC", "CNN",
  "Fortune", "Forbes", "MarketWatch", "WSJ", "The Wall Street Journal", "MSN",
  "Crypto Briefing", "Benzinga", "Motley Fool", "Investopedia", "Seeking Alpha",
  "Google News", "YouTube", "LinkedIn", "GitHub", "AI Magazine", "International Business Times",
  "HarianBasis.co", "Seoul", "South Korea",
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

const sourceCount = celebrities.reduce((sum, item) => sum + item.articles.length, 0);
const snapshot = {
  generatedAt,
  period,
  mode: sourceCount ? "Daily Live Snapshot" : "Fallback Snapshot",
  sourceStatus: sourceCount ? "Live public sources collected successfully." : "No live source was available. Fallback data is shown until the next successful update.",
  celebrities,
  sources: celebrities.flatMap(item => item.articles).slice(0, 80).map(article => ({
    title: article.title,
    url: article.url,
    source: article.source,
    publishedAt: article.publishedAt
  }))
};

await fs.writeFile(path.join(dataDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
await fs.writeFile(path.join(historyDir, `${dateOnly(new Date())}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Snapshot written for ${period} with ${celebrities.length} celebrities.`);

async function collectArticles(celebrity) {
  const queries = [
    `"${celebrity.name}" ${celebrity.company}`,
    `"${celebrity.company}" CEO ${celebrity.name}`,
    `${celebrity.company} ${celebrity.aliases.join(" OR ")}`
  ];
  const batches = await Promise.allSettled(queries.map(fetchGoogleNews));
  return dedupe(batches.flatMap(result => result.status === "fulfilled" ? result.value : [])).slice(0, 30);
}

async function fetchGoogleNews(query) {
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
      sourceType: "News RSS"
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
    name: `${celebrity.name} / ${celebrity.localName}`,
    company: celebrity.company,
    primaryCompanySignals,
    summary: articles.length
      ? `${celebrity.name} / ${celebrity.company} 今日抓到 ${articles.length} 則公開來源。最高分趨勢是 ${trends[0]?.title || "general news"}；外部關聯夥伴 ${partners.length} 個。`
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
          cooperation: "在公開新聞訊號中與此名人或其公司同時出現，需進一步人工或 RAG 驗證合作關係。",
          mentions: 0,
          occasions: [],
          first: !previousPartners.has(key),
          sourceTypes: new Set(),
          trend: matchTrend(article)
        });
      }
      const row = map.get(key);
      row.mentions += 1;
      row.occasions.push(`${article.source}: ${article.title}`);
      row.sourceTypes.add(article.sourceType || "News");
    }
  }
  return [...map.values()]
    .map(row => ({ ...row, sourceTypes: [...row.sourceTypes], occasions: row.occasions.slice(0, 3) }))
    .sort((a, b) => b.mentions - a.mentions || a.partner.localeCompare(b.partner))
    .slice(0, 18);
}

function extractPartners(celebrity, text) {
  const found = new Set([celebrity.company]);
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
  if (/\b(CEO|CFO|CTO|Investors|Says|Said|Just|This|Up|Down|Why|How|What|Which|After|Before|During|Called|Designing|Compares|Projects|Massive|Record|Highs|Amid)\b/i.test(phrase)) return false;
  return /(?:^|\s)(Group|Electronics|Motor|Semiconductor|Systems|Technologies|Labs|Robotics|Capital|Foundry|Holdings)$/i.test(phrase);
}

function normalizePartner(name) {
  return name
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s+\|\s+.*$/, "")
    .replace(/\s+(Inc|Corp|Corporation|Co|Ltd|LLC|PLC)\.?$/i, "")
    .replace(/^Nvidia$/i, "NVIDIA")
    .replace(/^Amd$/i, "AMD")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoisePartner(name, celebrity) {
  if (!name || name.length < 2) return true;
  if (mediaAndNoise.has(name)) return true;
  if (name === celebrity.name || name === celebrity.localName || name.includes(celebrity.name)) return true;
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
  return [celebrity.company, "OpenAI", "TSMC"].map(partner => ({
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
