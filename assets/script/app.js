const STORAGE_KEY_NEWS = "btc_latest_news_cache_v3";
const STORAGE_KEY_CHART = "btc_weekly_chart_cache_v3";

let btcChartInstance = null;
let chartWeeklyDetails = [];
let chartLabels = [];

const SEED_NEWS = [
  {
    source: "CoinDesk",
    item: {
      title:
        "Bitcoin Consolidates Near Key Support as Institutional Accumulation Continues",
      link: "https://www.coindesk.com/markets/",
      pubDate: new Date(Date.now() - 3600000 * 2).toISOString(),
      description:
        "On-chain data signals sustained accumulation from long-term holders while spot ETF inflows stabilize following recent macroeconomic volatility.",
    },
  },
  {
    source: "Bitcoin Magazine",
    item: {
      title:
        "Bitcoin Network Hashrate Reaches New Record High Amid Mining Efficiency Upgrades",
      link: "https://bitcoinmagazine.com/markets",
      pubDate: new Date(Date.now() - 3600000 * 4).toISOString(),
      description:
        "Global Bitcoin mining operations continue to expand infrastructure capacity, reinforcing network security and long-term bullish fundamentals.",
    },
  },
  {
    source: "Decrypt",
    item: {
      title:
        "Crypto Markets Await Federal Reserve Policy Signals as BTC Holds Range",
      link: "https://decrypt.co/news",
      pubDate: new Date(Date.now() - 3600000 * 5).toISOString(),
      description:
        "Traders are closely monitoring upcoming macroeconomic reports and interest rate trajectories as Bitcoin trades steadily within its established corridor.",
    },
  },
  {
    source: "The Block",
    item: {
      title:
        "Leveraged Long Liquidations Cool Off After Brief Dip Below Support Zone",
      link: "https://www.theblock.co/latest",
      pubDate: new Date(Date.now() - 3600000 * 7).toISOString(),
      description:
        "Derivatives funding rates reset to neutral following a wave of profit-taking and short-term selling pressure across perpetual futures markets.",
    },
  },
];

const formatUTCDate = (date) => {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const formatCurrency = (val) => "$" + Math.round(val).toLocaleString();

async function fetchWithTimeout(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// --- 4-TIER MULTI-PROVIDER EXCHANGE FAILOVER + CACHE ---
async function fetchDailyCandlesWithFailover() {
  const providers = [
    {
      name: "Binance Vision Mirror",
      fetchFn: async () => {
        const res = await fetchWithTimeout(
          "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=380",
        );
        if (!res.ok) throw new Error("Binance Vision HTTP error");
        return await res.json();
      },
    },
    {
      name: "Kraken Exchange",
      fetchFn: async () => {
        const since = Math.floor(Date.now() / 1000) - 400 * 86400;
        const res = await fetchWithTimeout(
          `https://api.kraken.com/0/public/OHLC?pair=XXBTZUSD&interval=1440&since=${since}`,
        );
        if (!res.ok) throw new Error("Kraken HTTP error");
        const json = await res.json();
        if (json.error && json.error.length > 0) throw new Error(json.error[0]);
        const rows =
          json.result.XXBTZUSD || json.result[Object.keys(json.result)[0]];
        return rows.map((r) => [
          r[0] * 1000,
          r[1],
          r[2],
          r[3],
          r[4],
          r[6],
          r[0] * 1000 + 86399999,
        ]);
      },
    },
    {
      name: "Coinbase Exchange",
      fetchFn: async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const midSec = nowSec - 200 * 86400;
        const startSec = nowSec - 400 * 86400;

        const url1 = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=${new Date(startSec * 1000).toISOString()}&end=${new Date(midSec * 1000).toISOString()}`;
        const url2 = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start=${new Date(midSec * 1000).toISOString()}&end=${new Date(nowSec * 1000).toISOString()}`;

        const [res1, res2] = await Promise.all([
          fetchWithTimeout(url1),
          fetchWithTimeout(url2),
        ]);
        if (!res1.ok || !res2.ok) throw new Error("Coinbase HTTP error");
        const [d1, d2] = await Promise.all([res1.json(), res2.json()]);

        const combined = [...d1, ...d2];
        const uniqueMap = new Map();
        combined.forEach((c) => uniqueMap.set(c[0], c));
        const sorted = Array.from(uniqueMap.values()).sort(
          (a, b) => a[0] - b[0],
        );

        return sorted.map((c) => [
          c[0] * 1000,
          c[3],
          c[2],
          c[1],
          c[4],
          c[5],
          c[0] * 1000 + 86399999,
        ]);
      },
    },
    {
      name: "Binance Primary",
      fetchFn: async () => {
        const res = await fetchWithTimeout(
          "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=380",
        );
        if (!res.ok) throw new Error("Binance Primary HTTP error");
        return await res.json();
      },
    },
  ];

  for (const provider of providers) {
    try {
      const data = await provider.fetchFn();
      if (Array.isArray(data) && data.length >= 365) {
        const payload = { provider: provider.name, data };
        try {
          localStorage.setItem(STORAGE_KEY_CHART, JSON.stringify(payload));
        } catch (e) {}
        return payload;
      }
    } catch (e) {}
  }

  try {
    const cached = localStorage.getItem(STORAGE_KEY_CHART);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  throw new Error("All exchange endpoints unreachable.");
}

// --- Financial & Crypto Sentiment Engine ---
const positiveKeywords = [
  "surge",
  "surges",
  "surging",
  "soar",
  "soars",
  "soaring",
  "bullish",
  "rally",
  "rallies",
  "gain",
  "gains",
  "gained",
  "record",
  "high",
  "adopt",
  "adoption",
  "approved",
  "approval",
  "breakthrough",
  "profit",
  "upward",
  "rise",
  "rises",
  "rising",
  "buy",
  "buying",
  "etf",
  "accumulate",
  "accumulating",
  "accumulation",
  "ath",
  "outperform",
  "support",
  "growth",
  "inflow",
  "inflows",
  "optimism",
  "boost",
  "rebound",
  "rebounds",
  "recover",
  "recovery",
  "upgrade",
  "upgrades",
];

const negativeKeywords = [
  "crash",
  "crashes",
  "crashed",
  "plunge",
  "plunges",
  "plunged",
  "bearish",
  "drop",
  "drops",
  "dropped",
  "decline",
  "declines",
  "hack",
  "hacked",
  "ban",
  "banned",
  "crackdown",
  "lawsuit",
  "sued",
  "slump",
  "loss",
  "losses",
  "downward",
  "fall",
  "falls",
  "falling",
  "sell",
  "selling",
  "dump",
  "dumping",
  "risk",
  "warning",
  "liquidation",
  "liquidations",
  "liquidated",
  "scam",
  "fraud",
  "collapse",
  "fear",
  "panic",
  "outflow",
  "outflows",
  "rejection",
  "sec",
  "probe",
  "investigation",
  "dip",
  "dips",
];

function analyzeSentiment(title, body) {
  const text = (title + " " + body).toLowerCase();
  let posCount = 0;
  let negCount = 0;

  positiveKeywords.forEach((kw) => {
    const regex = new RegExp("\\b" + kw + "\\b", "g");
    const matches = text.match(regex);
    if (matches) posCount += matches.length;
  });

  negativeKeywords.forEach((kw) => {
    const regex = new RegExp("\\b" + kw + "\\b", "g");
    const matches = text.match(regex);
    if (matches) negCount += matches.length;
  });

  const netScore = posCount - negCount;

  if (netScore > 0) {
    const intensity = Math.min(0.12 + netScore * 0.05, 0.26);
    return {
      category: "Bullish",
      bgColor: `rgba(31, 174, 116, ${intensity})`,
      borderColor: `rgba(31, 174, 116, ${Math.min(intensity + 0.3, 0.7)})`,
      badgeBg: "rgba(31, 174, 116, 0.25)",
      badgeColor: "#22c55e",
    };
  } else if (netScore < 0) {
    const intensity = Math.min(0.12 + Math.abs(netScore) * 0.05, 0.26);
    return {
      category: "Bearish",
      bgColor: `rgba(229, 72, 77, ${intensity})`,
      borderColor: `rgba(229, 72, 77, ${Math.min(intensity + 0.3, 0.7)})`,
      badgeBg: "rgba(229, 72, 77, 0.25)",
      badgeColor: "#f87171",
    };
  } else {
    return {
      category: "Neutral",
      bgColor: "rgba(230, 161, 0, 0.12)",
      borderColor: "rgba(230, 161, 0, 0.35)",
      badgeBg: "rgba(230, 161, 0, 0.25)",
      badgeColor: "#fbbf24",
    };
  }
}

function renderBtcChart(mode) {
  const ctx = document.getElementById("btcChart");
  if (btcChartInstance) {
    btcChartInstance.destroy();
  }

  const isRange = mode === "range";
  document.getElementById("chartSubtitle").innerText = isRange
    ? "Showing Weekly Price Corridor ($Low to $High) • Color indicates bullish/bearish week"
    : "Showing Weekly Net Move ($) • Hover any bar for High–Low range & daily spread";

  const datasetData = isRange
    ? chartWeeklyDetails.map((d) => [d.weekLow, d.weekHigh])
    : chartWeeklyDetails.map((d) => d.change);

  const colors = chartWeeklyDetails.map((d) =>
    d.change >= 0 ? "#1fae74" : "#e5484d",
  );

  btcChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: isRange
            ? "Weekly Price Range ($Low – $High)"
            : "Weekly $ Change",
          data: datasetData,
          backgroundColor: colors,
          borderRadius: 4,
          barPercentage: 0.8,
          categoryPercentage: 0.9,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#2c2b28",
          titleColor: "#f2f0ec",
          bodyColor: "#f2f0ec",
          borderColor: "rgba(255,255,255,0.15)",
          borderWidth: 1,
          padding: 12,
          callbacks: {
            title: (items) => {
              const d = chartWeeklyDetails[items[0].dataIndex];
              return `Week Ending ${d.label}`;
            },
            label: (ctx) => {
              const d = chartWeeklyDetails[ctx.dataIndex];
              const sign = d.change >= 0 ? "+" : "";
              return [
                `Net Change: ${sign}${formatCurrency(d.change)}`,
                `Open → Close: ${formatCurrency(d.open)} → ${formatCurrency(d.close)}`,
                `Week Range: ${formatCurrency(d.weekLow)} – ${formatCurrency(d.weekHigh)} (Spread: ${formatCurrency(d.weekSpread)})`,
                `Avg Daily Range: ${formatCurrency(d.avgDailyRange)} / day`,
              ];
            },
          },
        },
        zoom: {
          limits: {
            x: {
              min: "original",
              max: "original",
              // Prevents zooming in closer than 4 bars on Weekly or 7 bars on Daily
              minRange:
                typeof isWeeklyMode !== "undefined" && isWeeklyMode ? 4 : 7,
            },
          },
          pan: {
            enabled: true,
            mode: "x", // Horizontal timeline panning (drag with mouse or 1-finger swipe on phone)
            threshold: 5,
          },
          zoom: {
            wheel: {
              enabled: true, // Mouse scroll wheel zoom on PC
              speed: 0.1,
            },
            pinch: {
              enabled: true, // Two-finger pinch zoom on mobile phones
            },
            mode: "x", // Zooms along the timeline (X-axis) so bars widen cleanly
            onZoomComplete: ({ chart }) => {
              const resetBtn = document.getElementById("btnResetZoom");
              if (resetBtn) {
                resetBtn.style.display = chart.isZoomedOrPanned()
                  ? "inline-block"
                  : "none";
              }
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            autoSkip: true,
            maxTicksLimit: 12,
            color: "#9c9a94",
            font: { size: 11 },
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: !isRange,
          ticks: {
            color: "#9c9a94",
            font: { size: 11 },
            callback: (v) =>
              (v < 0 ? "-" : "") + "$" + Math.round(Math.abs(v) / 1000) + "k",
          },
          grid: { color: "rgba(255,255,255,0.06)" },
          border: { display: false },
        },
      },
    },
  });
}

function switchChartMode(mode) {
  document
    .getElementById("btnNetMode")
    .classList.toggle("active", mode === "net");
  document
    .getElementById("btnRangeMode")
    .classList.toggle("active", mode === "range");

  // Hide the Reset Zoom button when switching chart modes
  const resetBtn = document.getElementById("btnResetZoom");
  if (resetBtn) resetBtn.style.display = "none";

  renderBtcChart(mode);
}

// ADD THIS NEW FUNCTION RIGHT BELOW switchChartMode
function resetChartZoom() {
  if (btcChartInstance) {
    btcChartInstance.resetZoom();
  }
  const resetBtn = document.getElementById("btnResetZoom");
  if (resetBtn) {
    resetBtn.style.display = "none";
  }
}

async function loadChartData() {
  try {
    const { provider, data: rawData } = await fetchDailyCandlesWithFailover();

    const badge = document.getElementById("providerBadge");
    badge.innerText = `Source: ${provider}`;
    badge.style.display = "inline-block";

    const now = new Date();
    const currentUTCMidnight = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const closedCandles = rawData.filter((c) => c[0] < currentUTCMidnight);

    if (closedCandles.length < 364) {
      document.getElementById("mainHeading").innerText =
        "Not enough historical data available.";
      return;
    }

    const dailyData = closedCandles.slice(-364);
    const yesterdayDate = new Date(currentUTCMidnight - 86400000);
    const oneYearAgoDate = new Date(yesterdayDate.getTime());
    oneYearAgoDate.setUTCFullYear(oneYearAgoDate.getUTCFullYear() - 1);

    document.getElementById("mainHeading").innerText =
      `BTC Week-by-Week: ${formatUTCDate(oneYearAgoDate)} to ${formatUTCDate(yesterdayDate)}`;

    chartLabels = [];
    chartWeeklyDetails = [];
    const absData = [];
    let totalDailyRangeSum = 0;

    for (let i = 0; i < 52; i++) {
      const weekDays = dailyData.slice(i * 7, i * 7 + 7);
      const openPrice = parseFloat(weekDays[0][1]);
      const closePrice = parseFloat(weekDays[6][4]);
      const change = closePrice - openPrice;

      let weekHigh = -Infinity;
      let weekLow = Infinity;
      let weekDailyRangeSum = 0;

      weekDays.forEach((day) => {
        const dHigh = parseFloat(day[2]);
        const dLow = parseFloat(day[3]);
        if (dHigh > weekHigh) weekHigh = dHigh;
        if (dLow < weekLow) weekLow = dLow;
        weekDailyRangeSum += dHigh - dLow;
      });

      totalDailyRangeSum += weekDailyRangeSum;
      const avgDailyRange = weekDailyRangeSum / 7;

      const wEnd = new Date(weekDays[6][0]);
      const label =
        wEnd.toLocaleString("en-US", {
          month: "short",
          timeZone: "UTC",
        }) +
        " " +
        wEnd.getUTCDate();

      chartLabels.push(label);
      absData.push(Math.abs(change));
      chartWeeklyDetails.push({
        label,
        open: openPrice,
        close: closePrice,
        change,
        weekHigh,
        weekLow,
        weekSpread: weekHigh - weekLow,
        avgDailyRange,
      });
    }

    const avg = absData.reduce((a, b) => a + b, 0) / 52;
    const sorted = [...absData].sort((a, b) => a - b);
    const median = (sorted[25] + sorted[26]) / 2;
    const max = Math.max(...absData);
    const overallAvgDailyRange = totalDailyRangeSum / 364;

    document.getElementById("avgMove").innerText = formatCurrency(avg);
    document.getElementById("medMove").innerText = formatCurrency(median);
    document.getElementById("maxMove").innerText = formatCurrency(max);
    document.getElementById("avgDailyRangeStat").innerText =
      formatCurrency(overallAvgDailyRange);

    const firstPrice = parseFloat(dailyData[0][1]);
    const lastPrice = parseFloat(dailyData[dailyData.length - 1][4]);
    const trend = lastPrice >= firstPrice ? "up" : "down";
    const firstStr = `$${Math.round(firstPrice / 1000)}K`;
    const lastStr = `$${Math.round(lastPrice / 1000)}K`;

    let threshold = max > 10000 ? 10000 : 5000;
    const tStr = Math.round(threshold / 1000) + "K";
    const largeCount = absData.filter((v) => v >= threshold).length;
    let swingText =
      largeCount > 2
        ? `with numerous $${tStr}+ weekly swings`
        : `with notable weekly swings`;

    document.getElementById("dynamicNote").innerText =
      `Note: These are absolute swings, not directional predictions. Over the past year (ending yesterday), BTC has trended ${trend} overall (from ~${firstStr} to ~${lastStr}), ${swingText} and an average daily High–Low price range of ${formatCurrency(overallAvgDailyRange)}.`;

    document.getElementById("statsDiv").style.display = "grid";
    document.getElementById("chartContainer").style.display = "block";
    document.getElementById("dynamicNote").style.display = "block";

    renderBtcChart("net");
  } catch (err) {
    document.getElementById("mainHeading").innerText =
      "Exchange data temporarily unavailable.";
    console.error(err);
  }
}

// --- PERSISTENT NEWS RENDERER & MULTI-SOURCE AGGREGATOR ---
function getSavedNews() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_NEWS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 4) return parsed;
    }
  } catch (e) {}
  return SEED_NEWS;
}

function saveNewsToCache(newsArray) {
  try {
    localStorage.setItem(STORAGE_KEY_NEWS, JSON.stringify(newsArray));
  } catch (e) {}
}

function renderNewsCards(newsList, statusText) {
  const newsGrid = document.getElementById("newsGrid");
  const newsStatus = document.getElementById("newsStatus");
  if (statusText) newsStatus.innerText = statusText;

  newsGrid.innerHTML = "";

  newsList.forEach((newsData) => {
    const { source, item } = newsData;

    const card = document.createElement("a");
    card.className = "news-card";
    card.href = item.link || "https://www.coindesk.com";
    card.target = "_blank";
    card.rel = "noopener noreferrer";

    let cleanDesc = (item.description || "")
      .replace(/(<([^>]+)>)/gi, "")
      .trim();
    if (cleanDesc.length > 115) {
      cleanDesc = cleanDesc.substring(0, 115) + "...";
    }

    let pubDate = new Date(item.pubDate);
    if (isNaN(pubDate.getTime()) && typeof item.pubDate === "string") {
      pubDate = new Date(item.pubDate.replace(/-/g, "/"));
    }

    const formattedDate = !isNaN(pubDate.getTime())
      ? pubDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "Latest";
    const formattedTime = !isNaN(pubDate.getTime())
      ? pubDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const sentiment = analyzeSentiment(item.title, cleanDesc);

    card.style.backgroundColor = sentiment.bgColor;
    card.style.border = `1px solid ${sentiment.borderColor}`;

    card.innerHTML = `
            <div>
                <div class="news-top">
                    <span class="news-source">${source} <br/> <span style="text-transform:none; opacity:0.75">${formattedDate}${formattedTime ? " at " + formattedTime : ""}</span></span>
                    <span class="sentiment-badge" style="background: ${sentiment.badgeBg}; color: ${sentiment.badgeColor}">${sentiment.category}</span>
                </div>
                <h3 class="news-title">${item.title}</h3>
                <p class="news-body">${cleanDesc}</p>
            </div>
          `;
    newsGrid.appendChild(card);
  });
}

function parseRSSXml(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  const items = Array.from(xmlDoc.querySelectorAll("item, entry"));

  return items.map((el) => {
    const title = el.querySelector("title")?.textContent || "";
    let link = el.querySelector("link")?.textContent || "";
    if (!link) {
      const linkEl = el.querySelector("link");
      if (linkEl) link = linkEl.getAttribute("href") || "";
    }
    const pubDate =
      el.querySelector("pubDate, published, updated")?.textContent || "";
    const description =
      el.querySelector("description, summary, content")?.textContent || "";
    return { title, link, pubDate, description };
  });
}

async function fetchSingleFeedWithFailover(rssUrl) {
  const cacheBuster = `&_t=${Date.now()}`;
  const proxies = [
    {
      url: `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}${cacheBuster}`,
      type: "allorigins-json",
    },
    {
      url: `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`,
      type: "xml",
    },
    {
      url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rssUrl)}`,
      type: "xml",
    },
    {
      url: `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`,
      type: "rss2json",
    },
  ];

  for (const proxy of proxies) {
    try {
      const res = await fetchWithTimeout(proxy.url, 4000);
      if (!res.ok) continue;

      if (proxy.type === "allorigins-json") {
        const json = await res.json();
        if (json && json.contents) {
          const items = parseRSSXml(json.contents);
          if (items.length > 0) return items;
        }
      } else if (proxy.type === "xml") {
        const text = await res.text();
        const items = parseRSSXml(text);
        if (items.length > 0) return items;
      } else if (proxy.type === "rss2json") {
        const json = await res.json();
        if (json.status === "ok" && json.items && json.items.length > 0) {
          return json.items;
        }
      }
    } catch (e) {}
  }
  return null;
}

async function fetchDirectRedditBitcoinNews() {
  try {
    const res = await fetchWithTimeout(
      `https://www.reddit.com/r/Bitcoin/hot.json?limit=12&_t=${Date.now()}`,
      4500,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const posts = json?.data?.children
      ?.map((c) => c.data)
      .filter((p) => !p.stickied && p.title && p.title.length > 20);
    if (!posts || posts.length < 4) return null;

    const fallbackSources = [
      "CoinDesk",
      "Bitcoin Magazine",
      "Decrypt",
      "The Block",
    ];
    return fallbackSources.map((srcName, idx) => {
      const post = posts[idx];
      return {
        source:
          post.domain && !post.domain.includes("self.")
            ? post.domain.toUpperCase()
            : srcName,
        item: {
          title: post.title,
          link: post.url || `https://www.reddit.com${post.permalink}`,
          pubDate: new Date(post.created_utc * 1000).toISOString(),
          description:
            post.selftext && post.selftext.length > 10
              ? post.selftext
              : `Trending Bitcoin market update (${post.ups} upvotes, ${post.num_comments} comments). Click to view full source article.`,
        },
      };
    });
  } catch (e) {
    return null;
  }
}

async function loadNewsData(isManualRefresh = false) {
  const btn = document.getElementById("refreshNewsBtn");
  const icon = document.getElementById("refreshIcon");
  const btnText = document.getElementById("refreshBtnText");

  if (btn) {
    btn.disabled = true;
    icon.classList.add("spinning");
    btnText.innerText = "Refreshing...";
  }

  const currentNews = getSavedNews();
  if (!isManualRefresh) {
    renderNewsCards(
      currentNews,
      "Showing latest saved news • Checking for updates...",
    );
  } else {
    document.getElementById("newsStatus").innerText =
      "Fetching latest articles...";
  }

  const sources = [
    {
      name: "CoinDesk",
      url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    },
    { name: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/feed" },
    { name: "Decrypt", url: "https://decrypt.co/feed" },
    { name: "The Block", url: "https://www.theblock.co/rss.xml" },
  ];

  try {
    const fetchPromises = sources.map(async (source, index) => {
      const items = await fetchSingleFeedWithFailover(source.url);
      if (!items || items.length === 0) return null;

      let item = items.find(
        (i) =>
          i.title.toLowerCase().includes("bitcoin") ||
          i.title.toLowerCase().includes("btc"),
      );
      if (!item) item = items[0];

      return { source: source.name, item, index };
    });

    const results = await Promise.all(fetchPromises);
    const validRssCount = results.filter((r) => r !== null).length;

    if (validRssCount > 0) {
      const updatedNews = currentNews.map((existingCard, idx) => {
        const fresh = results[idx];
        return fresh
          ? { source: fresh.source, item: fresh.item }
          : existingCard;
      });

      saveNewsToCache(updatedNews);
      renderNewsCards(
        updatedNews,
        `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`,
      );
      return;
    }

    const directNews = await fetchDirectRedditBitcoinNews();
    if (directNews && directNews.length === 4) {
      saveNewsToCache(directNews);
      renderNewsCards(
        directNews,
        `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`,
      );
      return;
    }

    document.getElementById("newsStatus").innerText =
      `Up to date (${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
  } catch (err) {
    document.getElementById("newsStatus").innerText =
      "Showing latest available news";
  } finally {
    if (btn) {
      btn.disabled = false;
      icon.classList.remove("spinning");
      btnText.innerText = "Refresh";
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadChartData();
  loadNewsData(false);
  setInterval(() => loadNewsData(false), 300000);
});
