# 📈 BTC Weekly Price Movement & News Dashboard

A responsive, high-reliability web dashboard tracking Bitcoin week-by-week price action over a 52-week rolling window alongside aggregated crypto news and automated sentiment shading.

## ✨ Key Features
- **Dynamic Weekly Engine:** Automatically groups exact daily candles into 52 complete weekly intervals ending yesterday.
- **Robust 4-Tier Failover:** Seamlessly switches between **Binance Vision**, **Kraken**, **Coinbase**, and **Binance Primary** APIs to prevent regional blocks or timeouts.
- **Interactive Chart Modes:** Switch instantly between **Weekly Net Change ($)** and full **Weekly Price Range (High–Low)** corridor views.
- **Sentiment News Feed:** Aggregates live headlines from **CoinDesk**, **Bitcoin Magazine**, **Decrypt**, and **The Block**, automatically shading cards across a **Green/Yellow/Red** sentiment spectrum.
- **Stale-While-Revalidate Caching:** Instant loading with zero empty states via local storage persistence.
- **Isolated News Refresh:** Dedicated manual refresh button to update news feeds without reloading the chart.

## 📂 Project Structure
```text
btc-tracker-weekly/
├── README.md
├── index.html
└── assets/
    ├── style.css
    └── app.js
```

## 🚀 Quick Start & Deployment
1. Clone or download this repository.
2. Ensure `index.html` is in the root directory and `style.css` & `app.js` are inside the `assets/` folder.
3. Open `index.html` in any browser or enable **GitHub Pages** under your repository settings to host it for free.