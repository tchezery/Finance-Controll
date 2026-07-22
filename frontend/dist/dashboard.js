"use strict";
// @ts-nocheck
// ==========================================
// PORTFOLIO DASHBOARD — MAIN LOGIC
// Reads from portfolio_data.json
// Fetches live quotes from brapi.dev
// ==========================================
let PORTFOLIO_DATA = null;
let currentQuotes = {};
let activeFilter = 'all';
let chartInstances = {};
let historicalDataCache = {};
let assetAnalysisInitialized = false;
let activeSingleAsset = '';
let activeMultiAssets = new Set();
let activeDividendPeriod = '15';
let activeDividendAssets = new Set();
// ---- Load portfolio data from JSON ----
async function loadPortfolioData() {
    try {
        const resp = await fetch('/api/portfolio');
        if (!resp.ok) {
            let errData = { error: `HTTP ${resp.status}` };
            try {
                errData = await resp.json();
            }
            catch (_) { }
            console.error('Failed to load portfolio:', errData);
            const textEl = document.getElementById('updateTime');
            if (textEl)
                textEl.textContent = errData.error || 'Error loading data';
            return false;
        }
        const data = await resp.json();
        if (!data || !data.holdings || !data.trades) {
            console.error('Portfolio data is missing required fields:', data);
            return false;
        }
        PORTFOLIO_DATA = data;
        console.log('Portfolio data loaded:', PORTFOLIO_DATA.holdings.length, 'holdings');
        return true;
    }
    catch (err) {
        console.error('Failed to load portfolio data:', err);
        const textEl = document.getElementById('updateTime');
        if (textEl)
            textEl.textContent = 'Error loading data';
        return false;
    }
}
// ---- Fetch Live Quotes from brapi.dev ----
async function fetchQuotes() {
    if (!PORTFOLIO_DATA || !PORTFOLIO_DATA.holdings)
        return;
    const statusBadge = document.querySelector('.status-badge');
    const statusText = document.getElementById('updateTime');
    const lastUpdateEl = document.getElementById('lastUpdate');
    if (statusBadge)
        statusBadge.className = 'status-badge loading';
    if (statusText)
        statusText.textContent = 'Loading quotes...';
    const tickers = PORTFOLIO_DATA.holdings.map(h => h.ticker);
    let fetchedCount = 0;
    let failedCount = 0;
    for (const ticker of tickers) {
        try {
            const resp = await fetch(`https://brapi.dev/api/quote/list?search=${ticker}&limit=1`);
            const data = await resp.json();
            if (data.stocks && data.stocks.length > 0) {
                const stock = data.stocks[0];
                if (stock.stock === ticker) {
                    currentQuotes[ticker] = {
                        price: stock.close,
                        change: stock.change || 0,
                        name: stock.name || ticker,
                        logo: stock.logo || null
                    };
                    fetchedCount++;
                }
            }
        }
        catch (err) {
            console.warn(`Failed to fetch ${ticker}:`, err);
            failedCount++;
        }
    }
    if (tickers.length === 0) {
        if (statusBadge)
            statusBadge.className = 'status-badge';
        if (statusText)
            statusText.textContent = 'No quotes to load';
    }
    else if (fetchedCount > 0) {
        if (statusBadge)
            statusBadge.className = 'status-badge';
        if (statusText) {
            statusText.textContent = `${fetchedCount} quotes updated`;
            if (lastUpdateEl)
                lastUpdateEl.textContent =
                    `Updated: ${new Date().toLocaleString('en-US')}`;
        }
    }
    else {
        if (statusBadge)
            statusBadge.className = 'status-badge error';
        if (statusText)
            statusText.textContent = 'Failed to load quotes';
    }
    updateDashboard();
}
// ---- Utility Functions ----
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
function formatPercent(value) {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
}
function formatMonth(monthStr) {
    const [year, month] = monthStr.split('-');
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${months[parseInt(month) - 1]}/${year.slice(2)}`;
}
function getTickerColor(index) {
    const palette = [
        '#6366f1', '#8b5cf6', '#a78bfa', '#3b82f6', '#06b6d4',
        '#10b981', '#34d399', '#f59e0b', '#f97316', '#ef4444',
        '#ec4899', '#14b8a6', '#84cc16', '#a855f7', '#0ea5e9',
        '#f43f5e', '#22d3ee', '#c084fc', '#4ade80'
    ];
    return palette[index % palette.length];
}
function getCategoryColor(cat) {
    return { 'FII': '#6366f1', 'Ações': '#10b981', 'BDR': '#f59e0b' }[cat] || '#64748b';
}
// ---- Chart.js Global Config ----
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#94a3b8';
Chart.defaults.plugins.legend.display = false;
Chart.defaults.elements.point.radius = 0;
Chart.defaults.elements.point.hoverRadius = 5;
Chart.defaults.elements.line.tension = 0.4;
Chart.defaults.scale.grid.color = 'rgba(148, 163, 184, 0.06)';
Chart.defaults.scale.border = { display: false };
const tooltipConfig = {
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderWidth: 1,
    padding: 12,
    titleFont: { weight: '600' }
};
// ---- Update Dashboard ----
function updateDashboard() {
    updateKPIs();
    renderHoldingsTable();
    renderEvolutionChart();
    renderAllocationChart();
    renderInvestmentsChart();
    renderDividendsChart();
    renderHoldingsBarChart();
    renderPerformanceChart();
    renderTradesTimeline();
    if (!assetAnalysisInitialized) {
        initAssetAnalysisControls();
        assetAnalysisInitialized = true;
    }
    renderFullHistoryTable();
}
// ---- Toast Notification ----
function showToast(message, type = 'success') {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
// ---- KPIs ----
function updateKPIs() {
    let totalCurrentValue = 0;
    let totalBuyValue = 0;
    let totalDividends = 0;
    PORTFOLIO_DATA.holdings.forEach(h => {
        const quote = currentQuotes[h.ticker];
        const currentPrice = quote ? quote.price : h.avgPrice;
        totalCurrentValue += h.quotas * currentPrice;
        totalBuyValue += (h.totalCost !== undefined ? h.totalCost : h.quotas * h.avgPrice);
        if (h.dividends)
            totalDividends += h.dividends;
    });
    const profitLoss = totalCurrentValue - totalBuyValue;
    const profitPercent = totalBuyValue > 0 ? (profitLoss / totalBuyValue) * 100 : 0;
    document.getElementById('kpiTotalValue').textContent = formatCurrency(totalCurrentValue);
    const activeHoldingsCount = PORTFOLIO_DATA.holdings.filter(h => h.quotas > 0).length;
    document.getElementById('kpiTotalSub').textContent = `${activeHoldingsCount} assets in portfolio`;
    document.getElementById('kpiInvested').textContent = formatCurrency(totalBuyValue);
    const firstDate = PORTFOLIO_DATA.trades[0]?.date || '';
    document.getElementById('kpiInvestedSub').textContent = `Since ${firstDate.split('-').reverse().join('/')}`;
    const kpiDividendsEl = document.getElementById('kpiDividends');
    if (kpiDividendsEl) {
        kpiDividendsEl.textContent = formatCurrency(totalDividends);
        document.getElementById('kpiDividendsSub').textContent = `Since ${firstDate.split('-').reverse().join('/')}`;
    }
    const profitEl = document.getElementById('kpiProfit');
    const profitSubEl = document.getElementById('kpiProfitSub');
    profitEl.textContent = formatCurrency(profitLoss);
    profitSubEl.textContent = formatPercent(profitPercent);
    profitSubEl.className = `kpi-sub ${profitLoss >= 0 ? 'positive' : 'negative'}`;
    document.getElementById('kpiTrades').textContent = PORTFOLIO_DATA.totalTrades;
    const soldCount = PORTFOLIO_DATA.trades
        .filter(t => t.side === 'V')
        .reduce((acc, t) => { acc.add(t.ticker); return acc; }, new Set()).size;
    document.getElementById('kpiTradesSub').textContent = `${soldCount} assets sold`;
}
// ---- Holdings Table ----
function renderHoldingsTable() {
    const tbody = document.getElementById('holdingsBody');
    tbody.innerHTML = '';
    const filtered = activeFilter === 'all'
        ? PORTFOLIO_DATA.holdings.filter(h => h.quotas > 0)
        : PORTFOLIO_DATA.holdings.filter(h => h.category === activeFilter && h.quotas > 0);
    const sorted = [...filtered].sort((a, b) => {
        const aPrice = currentQuotes[a.ticker]?.price || a.avgPrice;
        const bPrice = currentQuotes[b.ticker]?.price || b.avgPrice;
        return (b.quotas * bPrice) - (a.quotas * aPrice);
    });
    sorted.forEach((h, index) => {
        const quote = currentQuotes[h.ticker];
        const currentPrice = quote ? quote.price : h.avgPrice;
        const currentValue = h.quotas * currentPrice;
        const dayChange = quote ? quote.change : 0;
        const totalReturn = h.avgPrice > 0 ? ((currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;
        const color = getTickerColor(index);
        const categoryClass = h.category === 'FII' ? 'fii' : h.category === 'Ações' ? 'acoes' : 'bdr';
        const changeClass = totalReturn >= 0 ? 'change-positive' : 'change-negative';
        const changeIcon = totalReturn >= 0 ? '▲' : '▼';
        const dayClass = dayChange >= 0 ? 'change-positive' : 'change-negative';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="ticker-cell">
                    <div class="ticker-avatar" style="background: ${color}">${h.ticker.slice(0, 2)}</div>
                    <div>
                        <span class="ticker-name">${h.ticker}</span>
                        <span class="ticker-trades">${h.trades} trades</span>
                    </div>
                </div>
            </td>
            <td><span class="category-badge ${categoryClass}">${h.category}</span></td>
            <td class="value-cell">${h.quotas}</td>
            <td class="value-cell">${formatCurrency(h.avgPrice)}</td>
            <td class="value-cell">
                ${formatCurrency(currentPrice)}
                <span class="${dayClass}" style="font-size:11px; display:block;">${dayChange >= 0 ? '▲' : '▼'} ${dayChange.toFixed(2)}%</span>
            </td>
            <td class="value-cell">
                <span class="${changeClass}" style="font-weight: 500;">${formatCurrency(currentValue)}</span>
            </td>
            <td class="value-cell">
                <span class="${changeClass}">${changeIcon} ${formatPercent(totalReturn)}</span>
            </td>
            <td class="value-cell">${formatCurrency(h.totalCost !== undefined ? h.totalCost : h.quotas * h.avgPrice)}</td>
            <td class="value-cell">${formatCurrency(h.dividends)}</td>
        `;
        tbody.appendChild(tr);
    });
}
function destroyChart(name) {
    if (chartInstances[name]) {
        chartInstances[name].destroy();
        chartInstances[name] = null;
    }
}
function renderEvolutionChart() {
    destroyChart('evolution');
    const ctx = document.getElementById('evolutionChart').getContext('2d');
    const data = PORTFOLIO_DATA.monthlyEvolution;
    const labels = data.map(d => formatMonth(d.month));
    const values = data.map(d => d.value);
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.25)');
    gradient.addColorStop(0.5, 'rgba(99, 102, 241, 0.08)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');
    chartInstances['evolution'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                    data: values,
                    borderColor: '#6366f1',
                    borderWidth: 2.5,
                    backgroundColor: gradient,
                    fill: true,
                    pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#1e1b4b',
                    pointBorderWidth: 2,
                    pointHoverRadius: 7,
                    pointHoverBackgroundColor: '#818cf8'
                }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    ...tooltipConfig,
                    callbacks: { label: ctx => `Investido: ${formatCurrency(ctx.raw)}` }
                }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 12, font: { size: 11 } } },
                y: { ticks: { font: { size: 11 }, callback: v => `R${(v / 1000).toFixed(1)}k` } }
            }
        }
    });
}
function renderAllocationChart() {
    destroyChart('allocation');
    const ctx = document.getElementById('allocationChart').getContext('2d');
    const filteredHoldings = PORTFOLIO_DATA.holdings.filter(h => h.quotas > 0);
    const categoryTotals = {};
    filteredHoldings.forEach(h => {
        const price = currentQuotes[h.ticker]?.price || h.avgPrice;
        categoryTotals[h.category] = (categoryTotals[h.category] || 0) + (h.quotas * price);
    });
    const labels = Object.keys(categoryTotals);
    const values = Object.values(categoryTotals);
    const total = values.reduce((a, b) => a + b, 0);
    const colors = labels.map(l => getCategoryColor(l));
    chartInstances['allocation'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderColor: 'rgba(10, 14, 23, 0.8)',
                    borderWidth: 3,
                    hoverOffset: 8
                }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                tooltip: {
                    ...tooltipConfig,
                    callbacks: {
                        label: ctx => {
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `${ctx.label}: ${formatCurrency(ctx.raw)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
    const legendEl = document.getElementById('allocationLegend');
    legendEl.innerHTML = '';
    labels.forEach((label, i) => {
        const pct = ((values[i] / total) * 100).toFixed(1);
        const item = document.createElement('div');
        item.className = 'alloc-item';
        item.innerHTML = `<div class="alloc-dot" style="background: ${colors[i]}"></div><span class="alloc-name">${label}</span><span class="alloc-value">${pct}%</span>`;
        legendEl.appendChild(item);
    });
}
let activeInvestmentsPeriod = '15';
function renderInvestmentsChart() {
    destroyChart('investments');
    const ctx = document.getElementById('investmentsChart').getContext('2d');
    let data = PORTFOLIO_DATA.monthlyInvestments;
    if (activeInvestmentsPeriod !== 'all') {
        data = data.slice(-parseInt(activeInvestmentsPeriod));
    }
    const labels = data.map(d => formatMonth(d.month));
    const values = data.map(d => d.invested);
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    chartInstances['investments'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                    data: values,
                    backgroundColor: gradient,
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 6
                }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { tooltip: { ...tooltipConfig, callbacks: { label: ctx => `Invested: ${formatCurrency(ctx.raw)}` } } },
            scales: { x: { ticks: { font: { size: 11 } } }, y: { ticks: { font: { size: 11 }, callback: v => `R\$${v}` } } }
        }
    });
}
function renderDividendsChart() {
    destroyChart('dividends');
    const ctx = document.getElementById('dividendsChart').getContext('2d');
    let allMonths = PORTFOLIO_DATA.monthlyDividends.map(d => d.month).sort();
    if (activeDividendPeriod !== 'all') {
        allMonths = allMonths.slice(-parseInt(activeDividendPeriod));
    }
    const labels = allMonths.map(m => formatMonth(m));
    let datasets = [];
    if (activeDividendAssets.size === 0) {
        // Show total portfolio dividends
        let data = PORTFOLIO_DATA.monthlyDividends;
        if (activeDividendPeriod !== 'all') {
            data = data.slice(-parseInt(activeDividendPeriod));
        }
        const values = data.map(d => d.dividends);
        const gradient = ctx.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
        datasets.push({
            label: 'Total Dividends',
            data: values,
            backgroundColor: gradient,
            borderColor: '#10b981',
            borderWidth: 1,
            borderRadius: 6
        });
    }
    else {
        // Stacked bars for selected assets
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
        let colorIdx = 0;
        activeDividendAssets.forEach(ticker => {
            const tickerData = PORTFOLIO_DATA.monthlyDividendsByTicker[ticker] || {};
            const values = allMonths.map(m => tickerData[m] || 0);
            const color = colors[colorIdx % colors.length];
            datasets.push({
                label: ticker,
                data: values,
                backgroundColor: color,
                borderWidth: 0,
                borderRadius: 4
            });
            colorIdx++;
        });
    }
    chartInstances['dividends'] = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#cbd5e1',
                    borderColor: 'rgba(51, 65, 85, 0.5)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`,
                        footer: (tooltipItems) => {
                            if (activeDividendAssets.size > 0) {
                                let total = 0;
                                tooltipItems.forEach(item => { total += item.raw; });
                                return `\nTotal: ${formatCurrency(total)}`;
                            }
                            return null;
                        }
                    }
                },
                legend: { display: activeDividendAssets.size > 0, position: 'top', labels: { color: '#94a3b8', boxWidth: 12 } }
            },
            scales: {
                x: { stacked: true, grid: { color: 'rgba(51, 65, 85, 0.2)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
                y: { stacked: true, grid: { color: 'rgba(51, 65, 85, 0.2)' }, ticks: { color: '#94a3b8', font: { size: 11 }, callback: v => `R\$${v}` } }
            }
        }
    });
}
function renderHoldingsBarChart() {
    destroyChart('holdingsBar');
    const ctx = document.getElementById('holdingsBarChart').getContext('2d');
    const sorted = [...PORTFOLIO_DATA.holdings].filter(h => h.quotas > 0).map(h => {
        return { ...h, currentValue: h.quotas * (currentQuotes[h.ticker]?.price || h.avgPrice) };
    }).sort((a, b) => b.currentValue - a.currentValue);
    const labels = sorted.map(h => h.ticker);
    const values = sorted.map(h => h.currentValue);
    const colors = sorted.map((_, i) => getTickerColor(i));
    chartInstances['holdingsBar'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderColor: '#000',
                    borderWidth: 1,
                    borderRadius: 0
                }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { tooltip: { ...tooltipConfig, callbacks: { label: ctx => `Value: ${formatCurrency(ctx.raw)}` } } },
            scales: {
                x: { ticks: { font: { size: 11, family: "'MS Sans Serif', Tahoma, sans-serif" }, callback: v => `R\$${(v / 1000).toFixed(1)}k` } },
                y: { ticks: { font: { size: 11, family: "'MS Sans Serif', Tahoma, sans-serif" } } }
            }
        }
    });
}
function renderPerformanceChart() {
    destroyChart('performance');
    const ctx = document.getElementById('performanceChart').getContext('2d');
    const withPerf = PORTFOLIO_DATA.holdings.filter(h => h.quotas > 0).map(h => {
        const price = currentQuotes[h.ticker]?.price || h.avgPrice;
        const perf = h.avgPrice > 0 ? ((price - h.avgPrice) / h.avgPrice) * 100 : 0;
        return { ...h, performance: perf, currentPrice: price };
    }).sort((a, b) => b.performance - a.performance);
    const labels = withPerf.map(h => h.ticker);
    const values = withPerf.map(h => h.performance);
    const bgColors = values.map(v => v >= 0 ? '#008000' : '#ff0000');
    const borderColors = values.map(v => '#000');
    chartInstances['performance'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    borderRadius: 0
                }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    ...tooltipConfig,
                    callbacks: {
                        label: ctx => {
                            const h = withPerf[ctx.dataIndex];
                            return [`Performance: ${formatPercent(ctx.raw)}`, `Avg: ${formatCurrency(h.avgPrice)} → Current: ${formatCurrency(h.currentPrice)}`];
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { font: { size: 11, family: "'MS Sans Serif', Tahoma, sans-serif" }, callback: v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%` } },
                y: { ticks: { font: { size: 11, family: "'MS Sans Serif', Tahoma, sans-serif" } } }
            }
        }
    });
}
let activeTradesPeriod = '15';
function renderTradesTimeline() {
    if (!PORTFOLIO_DATA || !PORTFOLIO_DATA.trades)
        return;
    destroyChart('trades');
    const ctx = document.getElementById('tradesChart').getContext('2d');
    const monthlyBuys = {};
    const monthlySells = {};
    PORTFOLIO_DATA.trades.forEach(t => {
        const month = t.date.slice(0, 7);
        if (t.side === 'C')
            monthlyBuys[month] = (monthlyBuys[month] || 0) + t.value;
        else
            monthlySells[month] = (monthlySells[month] || 0) + t.value;
    });
    const allMonths = [...new Set([...Object.keys(monthlyBuys), ...Object.keys(monthlySells)])].sort();
    let monthsToRender = allMonths;
    if (activeTradesPeriod !== 'all') {
        monthsToRender = allMonths.slice(-parseInt(activeTradesPeriod));
    }
    const labels = monthsToRender.map(m => formatMonth(m));
    const buyValues = monthsToRender.map(m => monthlyBuys[m] || 0);
    const sellValues = monthsToRender.map(m => -(monthlySells[m] || 0));
    chartInstances['trades'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Buys', data: buyValues, backgroundColor: 'rgba(16, 185, 129, 0.4)', borderColor: '#10b981', borderWidth: 1 },
                { label: 'Sells', data: sellValues, backgroundColor: 'rgba(239, 68, 68, 0.4)', borderColor: '#ef4444', borderWidth: 1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { tooltip: { ...tooltipConfig, callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(Math.abs(ctx.raw))}` } } },
            scales: { x: { stacked: true, ticks: { font: { size: 11 } } }, y: { stacked: true, ticks: { font: { size: 11 }, callback: v => `R\$${Math.abs(v).toFixed(0)}` } } }
        }
    });
}
// ---- Tab & Filter Interactions ----
// Nav Tabs Logic
document.querySelectorAll('.main-nav .nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (!tab.dataset.view)
            return;
        document.querySelectorAll('.main-nav .nav-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const targetView = tab.dataset.view;
        document.getElementById('dashboardPage').style.display = 'none';
        document.getElementById('profilePage').style.display = 'none';
        if (targetView === 'dashboardView') {
            document.getElementById('dashboardPage').style.display = 'block';
            document.getElementById('dashboardView').style.display = 'block';
            document.getElementById('historyView').style.display = 'none';
            if (typeof startDashboard === 'function')
                startDashboard();
        }
        else if (targetView === 'historyView') {
            document.getElementById('dashboardPage').style.display = 'block';
            document.getElementById('dashboardView').style.display = 'none';
            document.getElementById('historyView').style.display = 'block';
            renderFullHistoryTable();
        }
        else if (targetView === 'profileView') {
            document.getElementById('profilePage').style.display = 'block';
        }
    });
});
// Holdings Filter
document.querySelectorAll('#dashboardView .holdings-section .filter-tabs .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const siblings = tab.parentElement.querySelectorAll('.filter-tab');
        siblings.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        renderHoldingsTable();
    });
});
// History Filter
let activeHistoryFilter = 'all';
let activeHistoryTicker = 'all';
let activeHistoryPeriod = 'all';
document.querySelectorAll('#historyFilterTabs .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const siblings = tab.parentElement.querySelectorAll('.filter-tab');
        siblings.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeHistoryFilter = tab.dataset.filter;
        renderFullHistoryTable();
    });
});
const periodSelect = document.getElementById('historyPeriodFilter');
if (periodSelect) {
    periodSelect.addEventListener('change', (e) => {
        activeHistoryPeriod = e.target.value;
        renderFullHistoryTable();
    });
}
function initHistoryFilters() {
    if (!PORTFOLIO_DATA || !PORTFOLIO_DATA.trades)
        return;
    const select = document.getElementById('historyTickerFilter');
    if (!select)
        return;
    // Get unique tickers
    const tickers = [...new Set(PORTFOLIO_DATA.trades.map(t => t.ticker))].sort();
    tickers.forEach(t => {
        select.innerHTML += `<option value="${t}">${t}</option>`;
    });
    select.addEventListener('change', (e) => {
        activeHistoryTicker = e.target.value;
        renderFullHistoryTable();
    });
}
// ---- History Table Render ----
function renderFullHistoryTable() {
    if (!PORTFOLIO_DATA || !PORTFOLIO_DATA.trades)
        return;
    const tbody = document.getElementById('fullHistoryBody');
    if (!tbody)
        return;
    tbody.innerHTML = '';
    let trades = [...PORTFOLIO_DATA.trades];
    // Sort by date descending
    trades.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (activeHistoryFilter !== 'all') {
        trades = trades.filter(t => t.side === activeHistoryFilter);
    }
    if (activeHistoryTicker !== 'all') {
        trades = trades.filter(t => t.ticker === activeHistoryTicker);
    }
    if (activeHistoryPeriod !== 'all') {
        const now = new Date();
        let cutoff = new Date(0);
        if (activeHistoryPeriod === '30')
            cutoff = new Date(now.setDate(now.getDate() - 30));
        else if (activeHistoryPeriod === '180')
            cutoff = new Date(now.setMonth(now.getMonth() - 6));
        else if (activeHistoryPeriod === '365')
            cutoff = new Date(now.setFullYear(now.getFullYear() - 1));
        else if (activeHistoryPeriod === 'ytd')
            cutoff = new Date(new Date().getFullYear(), 0, 1);
        trades = trades.filter(t => new Date(t.date) >= cutoff);
    }
    trades.forEach(t => {
        const tr = document.createElement('tr');
        const isCompra = t.side === 'C';
        const typeBadge = isCompra ? '<span class="trade-badge trade-buy">Buy</span>' : '<span class="trade-badge trade-sell">Sell</span>';
        const categoryClass = t.category === 'FII' ? 'fii' : t.category === 'Ações' ? 'acoes' : 'bdr';
        const dateParts = t.date.split('-');
        const dateFormatted = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
        tr.innerHTML = `
            <td>${dateFormatted}</td>
            <td><strong>${t.ticker}</strong></td>
            <td><span class="category-badge ${categoryClass}">${t.category}</span></td>
            <td>${typeBadge}</td>
            <td class="value-cell">${t.qty}</td>
            <td class="value-cell">${formatCurrency(t.price)}</td>
            <td class="value-cell"><strong>${formatCurrency(t.value)}</strong></td>
        `;
        tbody.appendChild(tr);
    });
}
// ---- Asset Analysis Charts ----
async function fetchHistoricalData(ticker) {
    if (historicalDataCache[ticker])
        return historicalDataCache[ticker];
    try {
        const resp = await fetch(`/api/history/${ticker}`);
        const data = await resp.json();
        if (data && data.length > 0) {
            historicalDataCache[ticker] = data;
            return historicalDataCache[ticker];
        }
    }
    catch (e) {
        console.error("Error fetching historical for", ticker, e);
    }
    return [];
}
async function renderSingleAssetChart(ticker) {
    if (!ticker)
        return;
    const history = await fetchHistoricalData(ticker);
    if (!history || history.length === 0)
        return;
    destroyChart('singleAsset');
    const ctx = document.getElementById('singleAssetChart').getContext('2d');
    const labels = history.map(d => new Date(d.date * 1000).toLocaleDateString('pt-BR'));
    const prices = history.map(d => d.close);
    const trades = PORTFOLIO_DATA.trades.filter(t => t.ticker === ticker);
    const buyPoints = [];
    const sellPoints = [];
    const buyMeta = [];
    const sellMeta = [];
    history.forEach((h, i) => {
        const hDate = new Date(h.date * 1000).toISOString().split('T')[0];
        const dayTrades = trades.filter(t => t.date === hDate);
        let bought = false;
        let sold = false;
        let totalBuyQty = 0, totalBuyVal = 0;
        let totalSellQty = 0, totalSellVal = 0;
        dayTrades.forEach(t => {
            if (t.side === 'C') {
                bought = true;
                totalBuyQty += t.qty;
                totalBuyVal += t.value;
            }
            else if (t.side === 'V') {
                sold = true;
                totalSellQty += t.qty;
                totalSellVal += t.value;
            }
        });
        buyPoints.push(bought ? h.close : null);
        sellPoints.push(sold ? h.close : null);
        buyMeta.push(bought ? { qty: totalBuyQty, val: totalBuyVal } : null);
        sellMeta.push(sold ? { qty: totalSellQty, val: totalSellVal } : null);
    });
    chartInstances['singleAsset'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    type: 'scatter',
                    label: 'Buys',
                    data: buyPoints,
                    backgroundColor: '#10b981',
                    pointRadius: ctx => ctx.raw ? 6 : 0,
                    pointHoverRadius: 8,
                    order: 1
                },
                {
                    type: 'scatter',
                    label: 'Sells',
                    data: sellPoints,
                    backgroundColor: '#ef4444',
                    pointRadius: ctx => ctx.raw ? 6 : 0,
                    pointHoverRadius: 8,
                    order: 2
                },
                {
                    type: 'line',
                    label: 'Price (R$)',
                    data: prices,
                    borderColor: '#6366f1',
                    borderWidth: 2,
                    pointRadius: 0,
                    order: 3
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    ...tooltipConfig,
                    callbacks: {
                        label: ctx => {
                            if (ctx.dataset.label === 'Buys') {
                                const meta = buyMeta[ctx.dataIndex];
                                if (meta)
                                    return [`Bought: ${meta.qty} shares`, `Total: ${formatCurrency(meta.val)}`];
                            }
                            else if (ctx.dataset.label === 'Sells') {
                                const meta = sellMeta[ctx.dataIndex];
                                if (meta)
                                    return [`Sold: ${meta.qty} shares`, `Total: ${formatCurrency(meta.val)}`];
                            }
                            return `Price: ${formatCurrency(ctx.raw)}`;
                        }
                    }
                }
            },
            scales: { x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } }, y: { ticks: { font: { size: 11 } } } }
        }
    });
}
async function renderMultiAssetChart() {
    if (activeMultiAssets.size === 0) {
        destroyChart('multiAsset');
        return;
    }
    const datasets = [];
    const ArrayAssets = Array.from(activeMultiAssets);
    // 1. Fetch all data and gather unique dates
    const allData = {};
    let uniqueDatesMap = new Map(); // timestamp -> formatted date
    for (let i = 0; i < ArrayAssets.length; i++) {
        const ticker = ArrayAssets[i];
        const history = await fetchHistoricalData(ticker);
        if (!history || history.length === 0)
            continue;
        allData[ticker] = history;
        history.forEach(h => {
            // Use timestamp at start of day to normalize
            const d = new Date(h.date * 1000);
            d.setHours(0, 0, 0, 0);
            uniqueDatesMap.set(d.getTime(), d.toLocaleDateString('pt-BR'));
        });
    }
    // 2. Sort timestamps
    const sortedTimestamps = Array.from(uniqueDatesMap.keys()).sort((a, b) => a - b);
    const globalLabels = sortedTimestamps.map(ts => uniqueDatesMap.get(ts));
    // 3. Build datasets aligned to global labels
    for (let i = 0; i < ArrayAssets.length; i++) {
        const ticker = ArrayAssets[i];
        const history = allData[ticker];
        if (!history)
            continue;
        // Create a map of timestamp -> price for this ticker
        const priceMap = new Map();
        history.forEach(h => {
            const d = new Date(h.date * 1000);
            d.setHours(0, 0, 0, 0);
            priceMap.set(d.getTime(), h.close);
        });
        const firstValid = history.find(h => h.close > 0)?.close || 1;
        const normalized = [];
        let lastKnown = null;
        sortedTimestamps.forEach(ts => {
            if (priceMap.has(ts)) {
                lastKnown = priceMap.get(ts);
            }
            if (lastKnown !== null) {
                normalized.push(((lastKnown - firstValid) / firstValid) * 100);
            }
            else {
                normalized.push(null);
            }
        });
        datasets.push({
            label: ticker,
            data: normalized,
            borderColor: getTickerColor(i),
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1,
            spanGaps: true
        });
    }
    destroyChart('multiAsset');
    const ctx = document.getElementById('multiAssetChart').getContext('2d');
    chartInstances['multiAsset'] = new Chart(ctx, {
        type: 'line',
        data: { labels: globalLabels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { tooltip: { ...tooltipConfig, callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%` } } },
            scales: { x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } }, y: { ticks: { font: { size: 11 }, callback: v => `${v}%` } } }
        }
    });
}
function initAssetAnalysisControls() {
    const tickers = PORTFOLIO_DATA.holdings.map(h => h.ticker).sort();
    const singleSelect = document.getElementById('singleAssetSelect');
    singleSelect.innerHTML = '<option value="">Select an asset...</option>';
    tickers.forEach(t => {
        singleSelect.innerHTML += `<option value="${t}">${t}</option>`;
    });
    singleSelect.addEventListener('change', (e) => {
        activeSingleAsset = e.target.value;
        renderSingleAssetChart(activeSingleAsset);
    });
    const multiDropdown = document.getElementById('multiAssetDropdown');
    multiDropdown.innerHTML = '<option value="">+ Add asset</option>';
    multiDropdown.innerHTML += '<option value="ALL_ASSETS">* Compare All</option>';
    multiDropdown.innerHTML += '<option value="CLEAR_ALL">* Clear All</option>';
    tickers.forEach(t => {
        multiDropdown.innerHTML += `<option value="${t}">${t}</option>`;
    });
    const multiContainer = document.getElementById('multiAssetSelectContainer');
    function renderPills() {
        multiContainer.innerHTML = '';
        activeMultiAssets.forEach(t => {
            const pill = document.createElement('div');
            pill.className = 'ticker-pill active';
            pill.innerHTML = `${t} <span style="margin-left: 6px; font-weight: bold; font-size: 14px;">&times;</span>`;
            pill.addEventListener('click', () => {
                activeMultiAssets.delete(t);
                renderPills();
                renderMultiAssetChart();
            });
            multiContainer.appendChild(pill);
        });
    }
    multiDropdown.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!val)
            return;
        if (val === 'ALL_ASSETS') {
            activeMultiAssets = new Set(tickers);
        }
        else if (val === 'CLEAR_ALL') {
            activeMultiAssets.clear();
        }
        else {
            activeMultiAssets.add(val);
        }
        e.target.value = ''; // Reset dropdown after selection
        renderPills();
        renderMultiAssetChart();
    });
    // Dividends UI
    const divDropdown = document.getElementById('dividendAssetDropdown');
    const divContainer = document.getElementById('dividendAssetSelectContainer');
    if (divDropdown && divContainer) {
        divDropdown.innerHTML = '<option value="ALL">All Assets (Total)</option>';
        divDropdown.innerHTML += '<option value="CLEAR_ALL">* Clear All</option>';
        tickers.forEach(t => {
            divDropdown.innerHTML += `<option value="${t}">${t}</option>`;
        });
        function renderDivPills() {
            if (activeDividendAssets.size === 0) {
                divContainer.style.display = 'none';
                divDropdown.value = 'ALL';
                return;
            }
            divContainer.style.display = 'flex';
            divContainer.innerHTML = '';
            activeDividendAssets.forEach(t => {
                const pill = document.createElement('div');
                pill.className = 'ticker-pill active';
                pill.innerHTML = `${t} <span style="margin-left: 6px; font-weight: bold; font-size: 14px;">&times;</span>`;
                pill.addEventListener('click', () => {
                    activeDividendAssets.delete(t);
                    renderDivPills();
                    renderDividendsChart();
                });
                divContainer.appendChild(pill);
            });
        }
        divDropdown.addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val)
                return;
            if (val === 'ALL' || val === 'CLEAR_ALL') {
                activeDividendAssets.clear();
            }
            else {
                activeDividendAssets.add(val);
            }
            divDropdown.value = activeDividendAssets.size === 0 ? 'ALL' : '';
            renderDivPills();
            renderDividendsChart();
        });
    }
    if (tickers.length > 0) {
        singleSelect.value = tickers[0];
        activeSingleAsset = tickers[0];
        renderSingleAssetChart(tickers[0]);
        // Pre-select for multi-asset comparison
        activeMultiAssets.add(tickers[0]);
        if (tickers.length > 1)
            activeMultiAssets.add(tickers[1]);
        if (tickers.length > 2)
            activeMultiAssets.add(tickers[2]);
        renderPills();
        renderMultiAssetChart();
    }
}
async function saveChartPeriodToDB(period) {
    // Keep other settings the same, just update the default_chart_period in the DB
    const url = document.getElementById('sheetUrlInput').value;
    if (!url)
        return; // Don't save if no URL is set yet
    const mapDate = document.getElementById('mapDate').value;
    const mapAsset = document.getElementById('mapAsset').value;
    const mapType = document.getElementById('mapType').value;
    const mapQuantity = document.getElementById('mapQuantity').value;
    const mapPrice = document.getElementById('mapPrice').value;
    const mapTotalValue = document.getElementById('mapTotalValue').value;
    const buyIndicator = document.getElementById('buyIndicator').value;
    const sellIndicator = document.getElementById('sellIndicator').value;
    const dividendIndicator = document.getElementById('dividendIndicator').value;
    // Gather Custom Tickers
    const customTickers = {};
    document.querySelectorAll('.custom-ticker-row').forEach(row => {
        const name = row.querySelector('.ct-name').value.trim();
        const ticker = row.querySelector('.ct-ticker').value.trim();
        if (name && ticker) {
            customTickers[name] = ticker.toUpperCase();
        }
    });
    const column_mappings = {
        mapDate, mapAsset, mapType, mapQuantity, mapPrice, mapTotalValue,
        buyIndicator, sellIndicator, dividendIndicator, customTickers
    };
    const refreshInterval = document.getElementById('refreshIntervalSelect').value;
    const theme = document.getElementById('themeSelect') ? document.getElementById('themeSelect').value : 'theme-claude';
    try {
        await fetch('/api/user/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sheet_url: url,
                column_mappings,
                refresh_interval: refreshInterval,
                theme,
                default_chart_period: period
            })
        });
    }
    catch (e) {
        console.error("Failed to auto-save chart period", e);
    }
}
function initChartPeriodFilters() {
    const invSelect = document.getElementById('investmentsPeriodFilter');
    const trSelect = document.getElementById('tradesPeriodFilter');
    const divSelect = document.getElementById('dividendPeriodFilter');
    if (invSelect) {
        invSelect.addEventListener('change', (e) => {
            activeInvestmentsPeriod = e.target.value;
            renderInvestmentsChart();
            // Sync the other filter on the dashboard
            if (trSelect && trSelect.value !== activeInvestmentsPeriod) {
                trSelect.value = activeInvestmentsPeriod;
                activeTradesPeriod = activeInvestmentsPeriod;
                renderTradesTimeline();
            }
            if (divSelect && divSelect.value !== activeInvestmentsPeriod) {
                divSelect.value = activeInvestmentsPeriod;
                activeDividendPeriod = activeInvestmentsPeriod;
                renderDividendsChart();
            }
            saveChartPeriodToDB(activeInvestmentsPeriod);
        });
    }
    if (trSelect) {
        trSelect.addEventListener('change', (e) => {
            activeTradesPeriod = e.target.value;
            renderTradesTimeline();
            // Sync the other filter on the dashboard
            if (invSelect && invSelect.value !== activeTradesPeriod) {
                invSelect.value = activeTradesPeriod;
                activeInvestmentsPeriod = activeTradesPeriod;
                renderInvestmentsChart();
            }
            if (divSelect && divSelect.value !== activeTradesPeriod) {
                divSelect.value = activeTradesPeriod;
                activeDividendPeriod = activeTradesPeriod;
                renderDividendsChart();
            }
            saveChartPeriodToDB(activeTradesPeriod);
        });
    }
    if (divSelect) {
        divSelect.addEventListener('change', (e) => {
            activeDividendPeriod = e.target.value;
            renderDividendsChart();
            if (invSelect && invSelect.value !== activeDividendPeriod) {
                invSelect.value = activeDividendPeriod;
                activeInvestmentsPeriod = activeDividendPeriod;
                renderInvestmentsChart();
            }
            if (trSelect && trSelect.value !== activeDividendPeriod) {
                trSelect.value = activeDividendPeriod;
                activeTradesPeriod = activeDividendPeriod;
                renderTradesTimeline();
            }
            saveChartPeriodToDB(activeDividendPeriod);
        });
    }
}
// ==========================================
// Authentication & Settings
// ==========================================
async function handleCredentialResponse(response) {
    try {
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        const data = await res.json();
        if (data.success) {
            checkAuthState();
        }
        else {
            showToast('Login failed: ' + (data.error || 'Unknown error'), 'error');
            console.error("Login Error from server:", data.trace || data.error);
        }
    }
    catch (e) {
        console.error("Login request failed", e);
        showToast('Login request failed. See console.', 'error');
    }
}
// Make handleCredentialResponse available globally for Google Identity callback
window.handleCredentialResponse = handleCredentialResponse;
let currentPortfolios = [];
let activePortfolioId = null;
function populatePortfolioForm(id) {
    const btn = document.getElementById('deletePortfolioBtn');
    if (id) {
        const p = currentPortfolios.find(x => x.id == id);
        if (p) {
            document.getElementById('portfolioNameInput').value = p.name;
            document.getElementById('sheetUrlInput').value = p.sheet_url;
            if (p.column_mappings) {
                try {
                    const m = JSON.parse(p.column_mappings);
                    ['mapDate', 'mapAsset', 'mapType', 'mapQuantity', 'mapPrice', 'mapTotalValue'].forEach(mid => {
                        const el = document.getElementById(mid);
                        if (el && m[mid])
                            el.innerHTML = `<option value="${m[mid]}">${m[mid]}</option>`;
                    });
                    const buyInput = document.getElementById('buyIndicator');
                    if (buyInput)
                        buyInput.value = m.buyIndicator || '';
                    const sellInput = document.getElementById('sellIndicator');
                    if (sellInput)
                        sellInput.value = m.sellIndicator || '';
                    const divInput = document.getElementById('dividendIndicator');
                    if (divInput)
                        divInput.value = m.dividendIndicator || '';
                    document.getElementById('mappingSection').style.display = 'block';
                    // Render Custom Tickers
                    const ctList = document.getElementById('customTickersList');
                    if (ctList) {
                        ctList.innerHTML = '';
                        const customTickers = m.customTickers || {};
                        for (const [name, ticker] of Object.entries(customTickers)) {
                            addCustomTickerRow(name, ticker);
                        }
                    }
                }
                catch (e) { }
            }
            else {
                document.getElementById('mappingSection').style.display = 'none';
                const ctList = document.getElementById('customTickersList');
                if (ctList)
                    ctList.innerHTML = '';
            }
            if (btn)
                btn.style.display = 'inline-block';
            const shareBtn = document.getElementById('sharePortfolioBtn');
            const unshareBtn = document.getElementById('unsharePortfolioBtn');
            if (shareBtn && unshareBtn) {
                if (p.is_followed) {
                    shareBtn.style.display = 'none';
                    unshareBtn.style.display = 'none';
                }
                else {
                    shareBtn.style.display = 'inline-block';
                    if (p.share_token) {
                        unshareBtn.style.display = 'inline-block';
                    }
                    else {
                        unshareBtn.style.display = 'none';
                    }
                }
            }
        }
    }
    else {
        document.getElementById('portfolioNameInput').value = '';
        document.getElementById('sheetUrlInput').value = '';
        document.getElementById('mappingSection').style.display = 'none';
        const buyInput = document.getElementById('buyIndicator');
        if (buyInput)
            buyInput.value = '';
        const sellInput = document.getElementById('sellIndicator');
        if (sellInput)
            sellInput.value = '';
        const divInput = document.getElementById('dividendIndicator');
        if (divInput)
            divInput.value = '';
        if (btn)
            btn.style.display = 'none';
        const shareBtn = document.getElementById('sharePortfolioBtn');
        if (shareBtn)
            shareBtn.style.display = 'none';
        const unshareBtn = document.getElementById('unsharePortfolioBtn');
        if (unshareBtn)
            unshareBtn.style.display = 'none';
    }
}
function addCustomTickerRow(name = '', ticker = '') {
    const list = document.getElementById('customTickersList');
    if (!list)
        return;
    const div = document.createElement('div');
    div.className = 'custom-ticker-row';
    div.style.display = 'flex';
    div.style.gap = '8px';
    div.innerHTML = `
        <input type="text" class="styled-select ct-name" style="flex: 1; box-sizing: border-box; padding: 4px;" placeholder="Spreadsheet Name (e.g. GOOGLE DRN)" value="${name}">
        <span style="display:flex; align-items:center;">&rarr;</span>
        <input type="text" class="styled-select ct-ticker" style="width: 80px; box-sizing: border-box; padding: 4px;" placeholder="Ticker" value="${ticker}">
        <button class="nav-tab ct-remove" style="color: #ff6b6b; padding: 4px 8px; border-color: #ff6b6b; cursor:pointer;">X</button>
    `;
    div.querySelector('.ct-remove').addEventListener('click', () => {
        div.remove();
    });
    list.appendChild(div);
}
async function checkAuthState() {
    // Check for public share token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const shareToken = urlParams.get('share');
    if (shareToken) {
        // Public View Mode
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('headerProfileBtn').style.display = 'none';
        const headerSelect = document.getElementById('headerPortfolioSelect');
        if (headerSelect)
            headerSelect.style.display = 'none';
        try {
            const res = await fetch(`/api/shared/${shareToken}`);
            if (res.ok) {
                const data = await res.json();
                document.getElementById('userName').innerHTML = `<span class="first-name">${data.shared_by || 'Shared'}</span><span class="last-name"> Portfolio</span>`;
                document.getElementById('userProfile').style.display = 'flex';
                document.getElementById('exitPublicViewBtn').style.display = 'block';
                PORTFOLIO_DATA = data;
                dashboardStarted = true;
                initHistoryFilters();
                initChartPeriodFilters();
                await fetchQuotes();
                // Hide manual tabs
                document.getElementById('profilePage').style.display = 'none';
                document.getElementById('dashboardPage').style.display = 'block';
            }
            else {
                showToast('Invalid or expired share link', 'error');
                setTimeout(() => window.location.href = '/', 2000);
            }
        }
        catch (e) {
            console.error(e);
        }
        return;
    }
    try {
        const res = await fetch('/api/user');
        if (res.ok) {
            const user = await res.json();
            document.getElementById('loginOverlay').style.display = 'none';
            document.getElementById('userProfile').style.display = 'flex';
            document.getElementById('headerProfileBtn').style.display = 'inline-block';
            const nameParts = user.name.split(' ');
            const firstName = nameParts[0];
            const lastName = nameParts.length > 1 ? ' ' + nameParts.slice(1).join(' ') : '';
            document.getElementById('userName').innerHTML = `<span class="first-name">${firstName}</span><span class="last-name">${lastName}</span>`;
            // Populate profile page data
            document.getElementById('profileNameDisplay').textContent = user.name;
            document.getElementById('profileEmailDisplay').textContent = user.email;
            // Set global variables
            currentPortfolios = user.portfolios || [];
            activePortfolioId = user.active_portfolio_id;
            // Header Selector
            const headerSelect = document.getElementById('headerPortfolioSelect');
            if (headerSelect) {
                headerSelect.innerHTML = '';
                if (currentPortfolios.length > 0) {
                    headerSelect.style.display = 'inline-block';
                    currentPortfolios.forEach(p => {
                        const name = p.is_followed ? `${p.name} (Shared)` : p.name;
                        headerSelect.innerHTML += `<option value="${p.id}">${name}</option>`;
                    });
                    headerSelect.value = activePortfolioId;
                }
                else {
                    headerSelect.style.display = 'none';
                }
            }
            // Profile Editor Selector
            const profileSelect = document.getElementById('profilePortfolioSelect');
            if (profileSelect) {
                profileSelect.innerHTML = '<option value="">-- Select --</option>';
                currentPortfolios.forEach(p => {
                    const name = p.is_followed ? `${p.name} (Shared)` : p.name;
                    profileSelect.innerHTML += `<option value="${p.id}">${name}</option>`;
                });
                if (activePortfolioId) {
                    profileSelect.value = activePortfolioId;
                    populatePortfolioForm(activePortfolioId);
                }
                else {
                    populatePortfolioForm(null);
                }
            }
            if (user.refresh_interval !== undefined) {
                window.refreshMinutes = user.refresh_interval;
                const select = document.getElementById('refreshIntervalSelect');
                if (select)
                    select.value = window.refreshMinutes;
            }
            else {
                window.refreshMinutes = 3;
            }
            if (user.theme) {
                document.body.className = user.theme;
                const themeSelect = document.getElementById('themeSelect');
                if (themeSelect)
                    themeSelect.value = user.theme;
            }
            else {
                document.body.className = 'theme-claude';
            }
            if (user.default_chart_period) {
                activeInvestmentsPeriod = user.default_chart_period;
                activeTradesPeriod = user.default_chart_period;
                const invFilter = document.getElementById('investmentsPeriodFilter');
                if (invFilter)
                    invFilter.value = user.default_chart_period;
                const trFilter = document.getElementById('tradesPeriodFilter');
                if (trFilter)
                    trFilter.value = user.default_chart_period;
            }
            const activePortfolio = currentPortfolios.find(p => p.id == activePortfolioId);
            if (activePortfolio && activePortfolio.sheet_url) {
                showDashboard();
            }
            else {
                showProfile();
            }
        }
        else {
            // Not logged in
            document.getElementById('loginOverlay').style.display = 'flex';
            document.getElementById('userProfile').style.display = 'none';
            document.getElementById('dashboardPage').style.display = 'none';
            document.getElementById('profilePage').style.display = 'none';
            document.getElementById('updateTime').textContent = 'Please log in';
        }
    }
    catch (e) {
        console.error("Auth check failed", e);
    }
}
function showProfile() {
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('historyView').style.display = 'none';
    document.getElementById('profilePage').style.display = 'block';
    document.querySelectorAll('.main-nav .nav-tab').forEach(t => t.classList.remove('active'));
    const profileBtn = document.querySelector('.main-nav .nav-tab[data-view="profileView"]');
    if (profileBtn)
        profileBtn.classList.add('active');
}
function showDashboard() {
    document.getElementById('profilePage').style.display = 'none';
    document.getElementById('dashboardPage').style.display = 'block';
    document.getElementById('dashboardView').style.display = 'block';
    document.getElementById('historyView').style.display = 'none';
    document.querySelectorAll('.main-nav .nav-tab').forEach(t => t.classList.remove('active'));
    const dashboardBtn = document.querySelector('.main-nav .nav-tab[data-view="dashboardView"]');
    if (dashboardBtn)
        dashboardBtn.classList.add('active');
    startDashboard();
}
let dashboardStarted = false;
async function startDashboard() {
    if (dashboardStarted)
        return;
    document.getElementById('updateTime').textContent = 'Loading quotes...';
    if (await loadPortfolioData()) {
        dashboardStarted = true;
        initHistoryFilters();
        initChartPeriodFilters();
        await fetchQuotes();
        if (window.autoRefreshTimer)
            clearInterval(window.autoRefreshTimer);
        if (window.refreshMinutes > 0) {
            window.autoRefreshTimer = setInterval(async () => {
                console.log("Auto-updating quotes...");
                await fetchQuotes();
            }, window.refreshMinutes * 60 * 1000);
        }
    }
    else {
        document.getElementById('updateTime').textContent = 'Error loading data';
        showToast('Failed to load portfolio data. Please check your Google Sheets URL and mappings.', 'error');
        showProfile();
    }
}
document.addEventListener('DOMContentLoaded', () => {
    // Auth listeners
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        location.reload();
    });
    document.getElementById('backToDashboardBtn').addEventListener('click', () => {
        showDashboard();
    });
    document.getElementById('howToLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('instructionsModal').style.display = 'flex';
    });
    document.getElementById('closeInstructionsBtn')?.addEventListener('click', () => {
        document.getElementById('instructionsModal').style.display = 'none';
    });
    document.getElementById('gotItBtn')?.addEventListener('click', () => {
        document.getElementById('instructionsModal').style.display = 'none';
    });
    document.getElementById('headerPortfolioSelect')?.addEventListener('change', async (e) => {
        const id = e.target.value;
        await fetch('/api/user/active_portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ portfolio_id: id })
        });
        location.reload();
    });
    document.getElementById('profilePortfolioSelect')?.addEventListener('change', (e) => {
        populatePortfolioForm(e.target.value);
    });
    document.getElementById('createNewPortfolioBtn')?.addEventListener('click', () => {
        const profileSelect = document.getElementById('profilePortfolioSelect');
        if (profileSelect)
            profileSelect.value = '';
        populatePortfolioForm(null);
    });
    document.getElementById('deletePortfolioBtn')?.addEventListener('click', async () => {
        const profileSelect = document.getElementById('profilePortfolioSelect');
        const id = profileSelect ? profileSelect.value : null;
        if (!id)
            return;
        if (!confirm('Are you sure you want to delete this portfolio?'))
            return;
        const res = await fetch(`/api/portfolios/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Portfolio deleted', 'success');
            location.reload();
        }
        else {
            showToast('Failed to delete portfolio', 'error');
        }
    });
    document.getElementById('followPortfolioBtn')?.addEventListener('click', async () => {
        const tokenInput = document.getElementById('followTokenInput');
        const token = tokenInput.value.trim();
        if (!token)
            return showToast('Please enter a share token', 'error');
        const res = await fetch('/api/portfolios/follow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ share_token: token })
        });
        if (res.ok) {
            showToast('Portfolio followed successfully!', 'success');
            setTimeout(() => location.reload(), 1000);
        }
        else {
            const err = await res.json();
            showToast(err.message || err.error || 'Failed to follow portfolio', 'error');
        }
    });
    document.getElementById('sharePortfolioBtn')?.addEventListener('click', async () => {
        const profileSelect = document.getElementById('profilePortfolioSelect');
        const id = profileSelect ? profileSelect.value : null;
        if (!id)
            return;
        const res = await fetch(`/api/portfolios/${id}/share`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            // Re-fetch user data to update the local portfolio object with the new token so the Unshare button appears
            const userRes = await fetch('/api/user');
            if (userRes.ok) {
                const user = await userRes.json();
                currentPortfolios = user.portfolios || [];
                populatePortfolioForm(id);
            }
            navigator.clipboard.writeText(data.share_token).then(() => {
                showToast('Share token copied to clipboard!', 'success');
            }).catch(() => {
                showToast(`Share token: ${data.share_token}`, 'success');
            });
        }
        else {
            showToast('Failed to generate share token', 'error');
        }
    });
    document.getElementById('unsharePortfolioBtn')?.addEventListener('click', async () => {
        const profileSelect = document.getElementById('profilePortfolioSelect');
        const id = profileSelect ? profileSelect.value : null;
        if (!id)
            return;
        if (!confirm('Are you sure you want to make this portfolio private? Anyone following it will lose access.'))
            return;
        const res = await fetch(`/api/portfolios/${id}/unshare`, { method: 'POST' });
        if (res.ok) {
            showToast('Portfolio is now private!', 'success');
            const userRes = await fetch('/api/user');
            if (userRes.ok) {
                const user = await userRes.json();
                currentPortfolios = user.portfolios || [];
                populatePortfolioForm(id);
            }
        }
        else {
            showToast('Failed to unshare portfolio', 'error');
        }
    });
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
        const url = document.getElementById('sheetUrlInput').value;
        if (!url)
            return showToast('Please enter a Google Sheets CSV URL', 'error');
        const name = document.getElementById('portfolioNameInput').value;
        if (!name)
            return showToast('Please enter a Portfolio Name', 'error');
        const column_mappings = {
            mapDate: document.getElementById('mapDate').value.trim(),
            mapAsset: document.getElementById('mapAsset').value.trim(),
            mapType: document.getElementById('mapType').value.trim(),
            mapQuantity: document.getElementById('mapQuantity').value.trim(),
            mapPrice: document.getElementById('mapPrice').value.trim(),
            mapTotalValue: document.getElementById('mapTotalValue').value.trim(),
            buyIndicator: document.getElementById('buyIndicator')?.value.trim() || '',
            sellIndicator: document.getElementById('sellIndicator')?.value.trim() || '',
            dividendIndicator: document.getElementById('dividendIndicator')?.value.trim() || '',
        };
        const refreshInterval = document.getElementById('refreshIntervalSelect').value;
        const theme = document.getElementById('themeSelect') ? document.getElementById('themeSelect').value : 'theme-claude';
        // 1. Save general user settings
        await fetch('/api/user/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_interval: refreshInterval, theme, default_chart_period: activeInvestmentsPeriod })
        });
        // 2. Save Portfolio
        const profileSelect = document.getElementById('profilePortfolioSelect');
        const id = profileSelect ? profileSelect.value : null;
        let res;
        if (id) {
            res = await fetch(`/api/portfolios/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, sheet_url: url, column_mappings })
            });
        }
        else {
            res = await fetch('/api/portfolios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, sheet_url: url, column_mappings })
            });
        }
        const defaultChartPeriod = activeInvestmentsPeriod; // keep current active period
        if (res.ok) {
            document.body.className = theme;
            showToast('Settings saved successfully!', 'success');
            // If we created a new one, make it active and reload
            if (!id) {
                const data = await res.json();
                await fetch('/api/user/active_portfolio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ portfolio_id: data.id })
                });
            }
            location.reload();
        }
        else {
            const errData = await res.json();
            showToast('Failed to save settings: ' + (errData.error || 'Unknown error'), 'error');
        }
    });
    const downloadBtn = document.getElementById('downloadTemplateBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            window.location.href = '/api/template';
        });
    }
    const analyzeBtn = document.getElementById('analyzeSheetBtn');
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', async () => {
            const url = document.getElementById('sheetUrlInput').value;
            if (!url)
                return showToast('Please enter a Google Sheets URL first', 'error');
            analyzeBtn.textContent = 'Analyzing...';
            analyzeBtn.disabled = true;
            try {
                const res = await fetch('/api/sheet/headers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sheet_url: url })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    populateMappingSelects(data.headers);
                    document.getElementById('mappingSection').style.display = 'block';
                }
                else {
                    showToast('Failed to analyze sheet: ' + (data.error || 'Unknown error'), 'error');
                }
            }
            catch (err) {
                showToast('Error connecting to server.', 'error');
            }
            analyzeBtn.textContent = 'Analyze Sheet';
            analyzeBtn.disabled = false;
        });
    }
    function populateMappingSelects(headers) {
        const selects = ['mapDate', 'mapAsset', 'mapType', 'mapQuantity', 'mapPrice', 'mapTotalValue'];
        const currentVals = {};
        selects.forEach(id => currentVals[id] = document.getElementById(id).value);
        selects.forEach(id => {
            const el = document.getElementById(id);
            el.innerHTML = '<option value="">-- Select Column --</option>';
            headers.forEach(h => {
                const opt = document.createElement('option');
                opt.value = h;
                opt.textContent = h;
                el.appendChild(opt);
            });
            // Auto-match logic
            const lowerHeaders = headers.map(h => h.toLowerCase());
            let matched = false;
            if (id === 'mapDate' && lowerHeaders.includes('data pregão')) {
                el.value = headers[lowerHeaders.indexOf('data pregão')];
                matched = true;
            }
            if (id === 'mapAsset' && lowerHeaders.includes('especificação do título')) {
                el.value = headers[lowerHeaders.indexOf('especificação do título')];
                matched = true;
            }
            if (id === 'mapType' && lowerHeaders.includes('c/v')) {
                el.value = headers[lowerHeaders.indexOf('c/v')];
                matched = true;
            }
            if (id === 'mapQuantity' && lowerHeaders.includes('quantidade')) {
                el.value = headers[lowerHeaders.indexOf('quantidade')];
                matched = true;
            }
            if (id === 'mapPrice' && lowerHeaders.includes('preço (r$)')) {
                el.value = headers[lowerHeaders.indexOf('preço (r$)')];
                matched = true;
            }
            if (id === 'mapTotalValue' && lowerHeaders.includes('valor operação (r$)')) {
                el.value = headers[lowerHeaders.indexOf('valor operação (r$)')];
                matched = true;
            }
            if (!matched && headers.includes(currentVals[id])) {
                el.value = currentVals[id];
            }
        });
    }
    const manualRefreshBtn = document.getElementById('manualRefreshBtn');
    if (manualRefreshBtn) {
        manualRefreshBtn.addEventListener('click', async () => {
            await fetchQuotes();
        });
    }
    const viewPublicShareBtn = document.getElementById('viewPublicShareBtn');
    if (viewPublicShareBtn) {
        viewPublicShareBtn.addEventListener('click', () => {
            const token = document.getElementById('publicShareInput').value.trim();
            if (token) {
                window.location.href = `/?share=${token}`;
            }
        });
    }
    const exitPublicViewBtn = document.getElementById('exitPublicViewBtn');
    if (exitPublicViewBtn) {
        exitPublicViewBtn.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
    // Check auth on load
    checkAuthState();
});
