// ==========================================
// PORTFOLIO DASHBOARD — MAIN LOGIC
// Reads from portfolio_data.json
// Fetches live quotes from brapi.dev
// ==========================================

let PORTFOLIO_DATA = null;
let currentQuotes = {};
let activeFilter = 'all';
let chartInstances = {};

// ---- Load portfolio data from JSON ----
async function loadPortfolioData() {
    try {
        const resp = await fetch('./portfolio_data.json');
        PORTFOLIO_DATA = await resp.json();
        console.log('Portfolio data loaded:', PORTFOLIO_DATA.holdings.length, 'holdings');
        return true;
    } catch (err) {
        console.error('Failed to load portfolio_data.json:', err);
        document.getElementById('statusText').textContent = 'Erro ao carregar dados';
        return false;
    }
}

// ---- Fetch Live Quotes from brapi.dev ----
async function fetchQuotes() {
    const statusBadge = document.getElementById('statusBadge');
    const statusText = document.getElementById('statusText');

    statusBadge.className = 'status-badge loading';
    statusText.textContent = 'Carregando cotações...';

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
        } catch (err) {
            console.warn(`Failed to fetch ${ticker}:`, err);
            failedCount++;
        }
    }

    if (fetchedCount > 0) {
        statusBadge.className = 'status-badge';
        statusText.textContent = `${fetchedCount} cotações atualizadas`;
        document.getElementById('lastUpdate').textContent =
            `Atualizado: ${new Date().toLocaleString('pt-BR')}`;
    } else {
        statusBadge.className = 'status-badge error';
        statusText.textContent = 'Falha ao carregar cotações';
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
    renderHoldingsBarChart();
    renderPerformanceChart();
    renderTradesTimeline();
}

// ---- KPIs ----
function updateKPIs() {
    let totalCurrentValue = 0;
    let totalBuyValue = 0;

    PORTFOLIO_DATA.holdings.forEach(h => {
        const quote = currentQuotes[h.ticker];
        const currentPrice = quote ? quote.price : h.avgPrice;
        totalCurrentValue += h.quotas * currentPrice;
        totalBuyValue += h.buyValue;
    });

    const profitLoss = totalCurrentValue - totalBuyValue;
    const profitPercent = totalBuyValue > 0 ? (profitLoss / totalBuyValue) * 100 : 0;

    document.getElementById('kpiTotalValue').textContent = formatCurrency(totalCurrentValue);
    document.getElementById('kpiTotalSub').textContent = `${PORTFOLIO_DATA.holdings.length} ativos na carteira`;

    document.getElementById('kpiInvested').textContent = formatCurrency(totalBuyValue);
    const firstDate = PORTFOLIO_DATA.trades[0]?.date || '';
    document.getElementById('kpiInvestedSub').textContent = `Desde ${firstDate.split('-').reverse().join('/')}`;

    const profitEl = document.getElementById('kpiProfit');
    const profitSubEl = document.getElementById('kpiProfitSub');
    profitEl.textContent = formatCurrency(profitLoss);
    profitSubEl.textContent = formatPercent(profitPercent);
    profitSubEl.className = `kpi-sub ${profitLoss >= 0 ? 'positive' : 'negative'}`;

    document.getElementById('kpiTrades').textContent = PORTFOLIO_DATA.totalTrades;
    const soldCount = PORTFOLIO_DATA.trades
        .filter(t => t.side === 'V')
        .reduce((acc, t) => { acc.add(t.ticker); return acc; }, new Set()).size;
    document.getElementById('kpiTradesSub').textContent = `${soldCount} ativos vendidos`;
}

// ---- Holdings Table ----
function renderHoldingsTable() {
    const tbody = document.getElementById('holdingsBody');
    tbody.innerHTML = '';

    const filtered = activeFilter === 'all'
        ? PORTFOLIO_DATA.holdings
        : PORTFOLIO_DATA.holdings.filter(h => h.category === activeFilter);

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
            <td class="value-cell">${formatCurrency(currentValue)}</td>
            <td class="${changeClass}">${changeIcon} ${formatPercent(totalReturn)}</td>
            <td class="value-cell">${formatCurrency(h.buyValue)}</td>
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

    const categoryTotals = {};
    PORTFOLIO_DATA.holdings.forEach(h => {
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

function renderInvestmentsChart() {
    destroyChart('investments');
    const ctx = document.getElementById('investmentsChart').getContext('2d');
    const data = PORTFOLIO_DATA.monthlyInvestments.slice(-15);
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
            plugins: { tooltip: { ...tooltipConfig, callbacks: { label: ctx => `Aportado: ${formatCurrency(ctx.raw)}` } } },
            scales: { x: { ticks: { font: { size: 11 } } }, y: { ticks: { font: { size: 11 }, callback: v => `R\$${v}` } } }
        }
    });
}

function renderHoldingsBarChart() {
    destroyChart('holdingsBar');
    const ctx = document.getElementById('holdingsBarChart').getContext('2d');

    const sorted = [...PORTFOLIO_DATA.holdings].map(h => {
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
                backgroundColor: colors.map(c => c + '40'),
                borderColor: colors,
                borderWidth: 1.5,
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { tooltip: { ...tooltipConfig, callbacks: { label: ctx => `Valor: ${formatCurrency(ctx.raw)}` } } },
            scales: {
                x: { ticks: { font: { size: 11 }, callback: v => `R\$${(v / 1000).toFixed(1)}k` } },
                y: { ticks: { font: { size: 12, weight: '600' } } }
            }
        }
    });
}

function renderPerformanceChart() {
    destroyChart('performance');
    const ctx = document.getElementById('performanceChart').getContext('2d');

    const withPerf = PORTFOLIO_DATA.holdings.map(h => {
        const price = currentQuotes[h.ticker]?.price || h.avgPrice;
        const perf = h.avgPrice > 0 ? ((price - h.avgPrice) / h.avgPrice) * 100 : 0;
        return { ...h, performance: perf, currentPrice: price };
    }).sort((a, b) => b.performance - a.performance);

    const labels = withPerf.map(h => h.ticker);
    const values = withPerf.map(h => h.performance);
    const bgColors = values.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)');
    const borderColors = values.map(v => v >= 0 ? '#10b981' : '#ef4444');

    chartInstances['performance'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 4
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
                            return [`Performance: ${formatPercent(ctx.raw)}`, `PM: ${formatCurrency(h.avgPrice)} → Atual: ${formatCurrency(h.currentPrice)}`];
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { font: { size: 11 }, callback: v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%` } },
                y: { ticks: { font: { size: 12, weight: '600' } } }
            }
        }
    });
}

function renderTradesTimeline() {
    destroyChart('trades');
    const ctx = document.getElementById('tradesChart').getContext('2d');

    const monthlyBuys = {};
    const monthlySells = {};

    PORTFOLIO_DATA.trades.forEach(t => {
        const month = t.date.slice(0, 7);
        if (t.side === 'C') monthlyBuys[month] = (monthlyBuys[month] || 0) + t.value;
        else monthlySells[month] = (monthlySells[month] || 0) + t.value;
    });

    const allMonths = [...new Set([...Object.keys(monthlyBuys), ...Object.keys(monthlySells)])].sort();
    const last15 = allMonths.slice(-15);
    const labels = last15.map(m => formatMonth(m));
    const buyValues = last15.map(m => monthlyBuys[m] || 0);
    const sellValues = last15.map(m => -(monthlySells[m] || 0));

    chartInstances['trades'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Compras', data: buyValues, backgroundColor: 'rgba(16, 185, 129, 0.4)', borderColor: '#10b981', borderWidth: 1 },
                { label: 'Vendas', data: sellValues, backgroundColor: 'rgba(239, 68, 68, 0.4)', borderColor: '#ef4444', borderWidth: 1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { tooltip: { ...tooltipConfig, callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(Math.abs(ctx.raw))}` } } },
            scales: { x: { stacked: true, ticks: {font: {size: 11}} }, y: { stacked: true, ticks: {font: {size: 11}, callback: v => `R\$${Math.abs(v).toFixed(0)}` } } }
        }
    });
}

document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        renderHoldingsTable();
    });
});

document.addEventListener('DOMContentLoaded', async () => {
    if (await loadPortfolioData()) {
        await fetchQuotes();
    }
});
