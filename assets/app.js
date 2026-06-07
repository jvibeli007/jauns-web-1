const state = {
  snapshot: null,
  selectedCelebrityId: null,
  selectedTrendId: null,
  firstOnly: false,
  isUpdating: false,
  sourceMessage: "",
  recentTargets: [],
  messages: []
};

const recentTargetsKey = "celebrity-tracker-recent-targets";
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
}[char]));

init();

async function init() {
  state.snapshot = await loadSnapshot();
  state.recentTargets = loadRecentTargets();
  state.selectedCelebrityId = state.snapshot.celebrities[0]?.id;
  state.messages = [{ role: "bot", text: "你可以問：今天最高分趨勢、誰是首次出現、某 partner 出現在哪些來源、或有哪些資料來源。" }];

  bindEvents();
  renderAll();
}

async function loadSnapshot() {
  try {
    const response = await fetch("data/snapshot.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`snapshot ${response.status}`);
    return response.json();
  } catch (error) {
    return {
      generatedAt: "Not generated yet",
      period: "N/A",
      lookbackDays: 2,
      mode: "Local empty state",
      sourceStatus: `尚未讀到 data/snapshot.json：${error.message}`,
      celebrities: [{
        id: "empty",
        name: "尚未產生資料",
        company: "N/A",
        summary: "請先執行 npm run update，或在 GitHub Actions 手動執行 workflow 產生 snapshot。",
        metrics: { articles: 0, sources: 0, partners: 0, trends: 0 },
        primaryCompanySignals: [],
        trends: [],
        partners: [],
        articles: []
      }],
      sources: []
    };
  }
}

function bindEvents() {
  $("celebritySelect").addEventListener("change", event => {
    state.selectedCelebrityId = event.target.value;
    state.selectedTrendId = null;
    renderAll();
  });
  $("updateBtn").addEventListener("click", updateSnapshot);
  $("targetInput").addEventListener("keydown", event => {
    if (event.key === "Enter") updateSnapshot();
  });
  $("partnerSearch").addEventListener("input", renderPartners);
  $("sourceFilter").addEventListener("change", renderPartners);
  $("firstOnly").addEventListener("click", () => {
    state.firstOnly = !state.firstOnly;
    $("firstOnly").classList.toggle("on", state.firstOnly);
    renderPartners();
  });
  $("askBtn").addEventListener("click", () => ask());
  $("askInput").addEventListener("keydown", event => {
    if (event.key === "Enter") ask();
  });
}

function renderAll() {
  const celebrity = currentCelebrity();
  if (!state.selectedTrendId) state.selectedTrendId = celebrity.trends[0]?.id || null;

  $("snapshotMode").textContent = state.snapshot.mode || "Snapshot";
  $("generatedAt").textContent = state.snapshot.generatedAt || "";
  $("periodInput").value = state.snapshot.period || "";
  $("daysInput").value = state.snapshot.lookbackDays || $("daysInput").value || 2;
  $("sourceStatus").textContent = state.sourceMessage || state.snapshot.sourceStatus || "Snapshot loaded.";

  renderTrackingInputs();
  renderRecentTargets();
  renderCelebritySelect();
  renderMetrics();
  renderFiveP();
  renderSummary();
  renderTrends();
  renderSourceFilter();
  renderPartners();
  renderChat();
  renderQuickQuestions();
  renderSources();
}

function renderTrackingInputs() {
  if (!$("targetInput").value.trim()) {
    $("targetInput").value = state.snapshot.celebrities.map(item => displayName(item.name)).join(", ");
  }
  $("updateBtn").textContent = state.isUpdating ? "更新中..." : "更新 Snapshot";
  $("updateBtn").disabled = state.isUpdating;
}

function renderRecentTargets() {
  $("recentTargetsList").innerHTML = state.recentTargets.map(item =>
    `<option value="${esc(item.name)}" label="${esc(item.company ? `${item.name} — ${item.company}` : item.name)}"></option>`
  ).join("");
}

function currentCelebrity() {
  return state.snapshot.celebrities.find(item => item.id === state.selectedCelebrityId) || state.snapshot.celebrities[0];
}

function renderCelebritySelect() {
  $("celebritySelect").innerHTML = state.snapshot.celebrities.map(item =>
    `<option value="${esc(item.id)}" ${item.id === state.selectedCelebrityId ? "selected" : ""}>${esc(entityLabel(item))}</option>`
  ).join("");
}

async function updateSnapshot() {
  const celebrities = parseTargets($("targetInput").value);
  if (!celebrities.length) {
    $("sourceStatus").textContent = "請先輸入至少一位追蹤對象。";
    return;
  }

  state.isUpdating = true;
  state.sourceMessage = "正在抓取公開新聞並更新 snapshot...";
  $("sourceStatus").textContent = state.sourceMessage;
  renderTrackingInputs();

  try {
    const response = await fetch("/api/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        days: $("daysInput").value,
        celebrities
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "更新失敗");
    state.snapshot = await loadSnapshot();
    state.sourceMessage = "";
    saveRecentTargets(celebrities);
    state.selectedCelebrityId = state.snapshot.celebrities[0]?.id;
    state.selectedTrendId = null;
    state.messages = [{ role: "bot", text: result.message || "Snapshot 已更新。你可以問我本次最高分趨勢、首次出現或資料來源。" }];
  } catch (error) {
    state.sourceMessage = `更新失敗：${error.message}`;
  } finally {
    state.isUpdating = false;
    renderAll();
  }
}

function parseTargets(targetText) {
  return targetText.split(/[\s,，、;；/／|｜]+/)
    .map(name => name.trim())
    .filter(Boolean)
    .filter((name, index, list) => list.findIndex(item => item.toLowerCase() === name.toLowerCase()) === index)
    .map(name => ({
      name,
      company: "",
      aliases: [name]
    }));
}

function displayName(value) {
  return String(value || "").split(" / ")[0].trim();
}

function entityLabel(item) {
  return item.company && item.company !== "N/A" ? `${item.name} — ${item.company}` : item.name;
}

function loadRecentTargets() {
  try {
    const stored = JSON.parse(localStorage.getItem(recentTargetsKey) || "[]");
    return Array.isArray(stored) ? normalizeRecentTargets(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentTargets(celebrities) {
  state.recentTargets = normalizeRecentTargets([...celebrities, ...state.recentTargets]).slice(0, 5);
  try {
    localStorage.setItem(recentTargetsKey, JSON.stringify(state.recentTargets));
  } catch {}
}

function normalizeRecentTargets(items) {
  const seen = new Set();
  return items.map(item => ({
    name: String(item.name || "").trim(),
    company: String(item.company || "").trim()
  })).filter(item => item.name).map(item => ({
    ...item,
    key: recentTargetKey(item)
  })).filter(item => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function recentTargetKey(item) {
  return item.name.toLowerCase();
}

function renderMetrics() {
  const metrics = currentCelebrity().metrics || {};
  const rows = [
    ["Articles", metrics.articles || 0, "去重後公開來源"],
    ["Source layers", metrics.sources || 0, "不同來源網域"],
    ["External partners", metrics.partners || 0, "外部關聯公司"],
    ["Trends", metrics.trends || 0, "趨勢分群"]
  ];
  $("metrics").innerHTML = rows.map(row => `
    <div class="metric">
      <span>${esc(row[0])}</span>
      <strong>${esc(row[1])}</strong>
      <span>${esc(row[2])}</span>
    </div>
  `).join("");
}

function renderFiveP() {
  const celebrity = currentCelebrity();
  const topTrend = celebrity.trends[0]?.title || "尚無趨勢";
  const topPartners = externalPartners(celebrity).slice(0, 4).map(row => row.partner).join("、") || "尚無外部 partner";
  const primarySignals = primarySignalsFor(celebrity).map(row => `${row.partner} ${row.mentions} 次`).join("、") || entityLabel(celebrity);
  const boxes = [
    ["Person", entityLabel(celebrity)],
    ["Period", state.snapshot.period],
    ["Points", topTrend],
    ["Company", primarySignals],
    ["External partners", topPartners],
    ["Proof", `${celebrity.articles.length || 0} source articles`]
  ];
  $("fiveP").innerHTML = boxes.map(([title, body]) =>
    `<div class="info-box"><b>${esc(title)}</b><p>${esc(body)}</p></div>`
  ).join("");
}

function renderSummary() {
  const celebrity = currentCelebrity();
  const primaryRows = primarySignalsFor(celebrity);
  $("summary").innerHTML = `
    <div class="info-box">
      <b>${esc(celebrity.name)}</b>
      <p>${esc(celebrity.summary)}</p>
      ${primaryRows.length ? `
        <div class="signal-list">
          ${primaryRows.map(row => `
            <span class="signal-pill">
              <b>${esc(row.partner)}</b>
              <span>${esc(row.mentions)} mentions</span>
            </span>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderTrends() {
  const celebrity = currentCelebrity();
  if (!celebrity.trends.length) {
    $("trendList").innerHTML = `<div class="empty">尚未抓到趨勢資料。</div>`;
    $("trendDetail").innerHTML = `<div class="empty">手動更新後會顯示趨勢摘要。</div>`;
    return;
  }
  $("trendList").innerHTML = celebrity.trends.map(trend => `
    <button class="trend-btn ${trend.id === state.selectedTrendId ? "active" : ""}" data-trend="${esc(trend.id)}" type="button">
      <b>${esc(trend.title)}</b>
      <small>score ${esc(trend.score)}</small>
    </button>
  `).join("");
  document.querySelectorAll("[data-trend]").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedTrendId = button.dataset.trend;
      renderTrends();
    });
  });
  const trend = celebrity.trends.find(item => item.id === state.selectedTrendId) || celebrity.trends[0];
  $("trendDetail").innerHTML = `
    <div class="chips">${trend.technology.map(item => `<span class="chip">${esc(item)}</span>`).join("")}</div>
    <h3>${esc(trend.title)}</h3>
    <p>${esc(trend.summary)}</p>
    <p><b>影響：</b>${esc(trend.impact)}</p>
    <div class="chips">${trend.sources.map(item => `<span class="chip">${esc(item)}</span>`).join("")}</div>
  `;
}

function renderSourceFilter() {
  const sources = new Set(["All"]);
  externalPartners(currentCelebrity()).forEach(row => row.sourceTypes.forEach(type => sources.add(type)));
  const selected = $("sourceFilter").value || "All";
  $("sourceFilter").innerHTML = [...sources].map(source =>
    `<option value="${esc(source)}" ${source === selected ? "selected" : ""}>${esc(source)}</option>`
  ).join("");
}

function filteredPartners() {
  const query = $("partnerSearch").value.toLowerCase();
  const source = $("sourceFilter").value;
  return externalPartners(currentCelebrity()).filter(row => {
    const text = `${row.partner} ${row.type} ${row.cooperation} ${row.trend}`.toLowerCase();
    return (!query || text.includes(query))
      && (source === "All" || row.sourceTypes.includes(source))
      && (!state.firstOnly || row.first);
  });
}

function renderPartners() {
  const rows = filteredPartners();
  renderBar(rows);
  $("partnerBody").innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>
        <span class="partner-hover" tabindex="0" title="${esc(marketTooltipText(row.market))}">
          <b>${esc(row.partner)}</b>
          ${marketTooltip(row.market)}
        </span>
        <div class="muted">${esc(row.type)}</div>
        <div>${row.sourceTypes.map(type => `<span class="badge light">${esc(type)}</span>`).join(" ")}</div>
      </td>
      <td>${esc(row.cooperation)}</td>
      <td><b>${esc(row.mentions)}</b></td>
      <td>${row.occasions.map(item => `• ${esc(item)}`).join("<br>")}</td>
      <td><span class="badge ${row.first ? "first" : "light"}">${row.first ? "首次" : "非首次"}</span></td>
      <td><span class="badge light">${esc(row.trend)}</span></td>
    </tr>
  `).join("") : `<tr><td colspan="6"><div class="empty">沒有符合條件的 partner。</div></td></tr>`;
}

function marketTooltip(market) {
  if (!market || market.status !== "ok") {
    return `<span class="market-tip"><b>Market data</b><span>N/A</span></span>`;
  }
  const price = market.price == null ? "N/A" : `${formatNumber(market.price)} ${market.currency || ""}`.trim();
  const eps2025 = market.eps2025 == null ? "N/A" : formatNumber(market.eps2025);
  const eps2026 = market.eps2026 == null ? "N/A" : formatNumber(market.eps2026);
  return `
    <span class="market-tip">
      <b>${esc(market.symbol || "Market")}</b>
      <span>股價 ${esc(price)}</span>
      <span>EPS 2025 ${esc(eps2025)}</span>
      <span>EPS 2026 ${esc(eps2026)}</span>
    </span>
  `;
}

function marketTooltipText(market) {
  if (!market || market.status !== "ok") return "Market data: N/A";
  const price = market.price == null ? "N/A" : `${formatNumber(market.price)} ${market.currency || ""}`.trim();
  const eps2025 = market.eps2025 == null ? "N/A" : formatNumber(market.eps2025);
  const eps2026 = market.eps2026 == null ? "N/A" : formatNumber(market.eps2026);
  return `${market.symbol || "Market"} | 股價 ${price} | EPS 2025 ${eps2025} | EPS 2026 ${eps2026}`;
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function renderBar(rows) {
  const max = Math.max(1, ...rows.map(row => row.mentions));
  $("barChart").innerHTML = rows.length ? rows.map(row => `
    <div class="bar-row">
      <div class="bar-label">
        <span class="partner-hover" tabindex="0" title="${esc(marketTooltipText(row.market))}">
          <b>${esc(row.partner)}</b>
          ${marketTooltip(row.market)}
        </span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${(row.mentions / max) * 100}%"></div></div>
      <div class="bar-value">${esc(row.mentions)}</div>
    </div>
  `).join("") : `<div class="empty">目前沒有可畫圖的 partner 資料。</div>`;
}

function ask(value) {
  const input = value || $("askInput").value;
  if (!input.trim()) return;
  state.messages.push({ role: "user", text: input.trim() });
  state.messages.push({ role: "bot", text: answer(input) });
  $("askInput").value = "";
  renderChat();
}

function answer(input) {
  const celebrity = currentCelebrity();
  const lower = input.toLowerCase();
  if (lower.includes("首次") || lower.includes("first")) {
    const firstRows = externalPartners(celebrity).filter(row => row.first);
    return firstRows.length
      ? `本次 snapshot 首次出現的外部 partner：${firstRows.map(row => `${row.partner}（${row.mentions} 次）`).join("、")}。`
      : "目前沒有新的首次出現外部 partner。歷史檔越多，這個判斷會越準。";
  }
  if (lower.includes("最高") || lower.includes("趨勢") || lower.includes("trend")) {
    const trend = celebrity.trends[0];
    return trend ? `最高分趨勢是 ${trend.title}，分數 ${trend.score}。${trend.summary}` : "目前尚無趨勢資料。";
  }
  if (lower.includes("來源") || lower.includes("source")) {
    const sources = celebrity.articles.slice(0, 6).map(article => `${article.source}: ${article.title}`);
    return sources.length ? `主要來源：\n${sources.join("\n")}` : "目前沒有來源資料。";
  }
  if (lower.includes("提及") || lower.includes("top")) {
    const primary = primarySignalsFor(celebrity).map(row => `${row.partner} ${row.mentions} 次`).join("；");
    const top = [...externalPartners(celebrity)].sort((a, b) => b.mentions - a.mentions).slice(0, 6);
    return top.length
      ? `主體公司訊號：${primary || "尚無"}\n外部 partner 提及 Top：${top.map(row => `${row.partner} ${row.mentions} 次`).join("；")}`
      : `主體公司訊號：${primary || "尚無"}\n目前沒有外部 partner 提及資料。`;
  }
  const partner = [...primarySignalsFor(celebrity), ...externalPartners(celebrity)].find(row => lower.includes(row.partner.toLowerCase()));
  if (partner) {
    return `${partner.partner}\n提及次數：${partner.mentions}\n趨勢：${partner.trend}\n摘要：${partner.cooperation}\n來源場合：${partner.occasions.join("；")}`;
  }
  return "我目前能根據最新 snapshot 回答：最高分趨勢、首次出現外部 partner、提及次數 top、資料來源，以及特定公司或 partner 的來源場合。";
}

function renderChat() {
  $("chat").innerHTML = state.messages.map(message => `
    <div class="msg ${esc(message.role)}"><div class="bubble">${esc(message.text)}</div></div>
  `).join("");
  $("chat").scrollTop = $("chat").scrollHeight;
}

function renderQuickQuestions() {
  const questions = ["今天最高分趨勢是什麼？", "誰是首次出現？", "提及次數 top", "有哪些資料來源？"];
  $("quickQuestions").innerHTML = questions.map((question, index) =>
    `<button type="button" data-question="${index}">${esc(question)}</button>`
  ).join("");
  document.querySelectorAll("[data-question]").forEach((button, index) => {
    button.addEventListener("click", () => ask(questions[index]));
  });
}

function renderSources() {
  const articles = currentCelebrity().articles.slice(0, 12);
  $("sources").innerHTML = articles.length ? articles.map(article => `
    <article class="source-card">
      <b>${esc(article.title)}</b>
      <p>${esc(article.source)} · ${esc(article.sourceType || "News")} · ${esc(formatDate(article.publishedAt))}</p>
      <p><a href="${esc(article.url)}" target="_blank" rel="noreferrer">Open source</a></p>
    </article>
  `).join("") : `<div class="empty">目前沒有可顯示的來源。手動更新完成後會出現在這裡。</div>`;
}

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

function primarySignalsFor(celebrity) {
  return celebrity.primaryCompanySignals?.length
    ? celebrity.primaryCompanySignals
    : (celebrity.partners || []).filter(row => row.type === "Tracked company");
}

function externalPartners(celebrity) {
  return (celebrity.partners || []).filter(row => row.type !== "Tracked company");
}
