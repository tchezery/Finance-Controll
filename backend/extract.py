import pandas as pd
import json
import re
import unicodedata
import urllib.request
import urllib.parse
from collections import defaultdict
from datetime import datetime
import os
from dividends import calculate_auto_dividends

# In-memory cache for API-resolved tickers (persists for the process lifetime)
_ticker_cache = {}

# ==========================================
# BRAPI.DEV TICKER RESOLUTION
# ==========================================

def _strip_accents(text: str) -> str:
    """Remove accented characters (e.g. Ú → U, É → E)."""
    nfkd = unicodedata.normalize('NFKD', text)
    return ''.join(c for c in nfkd if not unicodedata.combining(c))

def _detect_asset_type(name: str) -> str:
    """Detect the likely B3 asset type from the raw sheet name."""
    upper = name.upper()
    if 'DRN' in upper or 'BDR' in upper:
        return 'bdr'
    if 'FII' in upper or 'FIAGRO' in upper or 'ISHARE' in upper or 'NU REND' in upper:
        return 'fund'
    return 'stock'

def _extract_search_term(name: str) -> str:
    """Extract a clean company/fund keyword from the B3 full title for API search."""
    clean = name.strip()
    # Remove common B3 suffixes: CI, ER, ERA, ES, EJ, ED, ATZ, D, N1, N2, NM, DRN, PN, ON
    clean = re.sub(r'\s+(?:CI\s+)?(?:ER[A]?|ES|EJ|ED|ATZ|D)?\s*(?:[@#]+)?\s*$', '', clean)
    clean = re.sub(r'\s+(?:N[12M]+|CI|DRN|BDR|PN|ON)\s*$', '', clean)
    clean = re.sub(r'\s+(?:CI|DRN|BDR|PN|ON)\s*$', '', clean)  # second pass
    clean = clean.strip()
    
    # For FII/FIAGRO names like "FII CORPORATE CI", extract the fund name part
    fii_match = re.match(r'^(?:FII|FIAGRO)\s+(.+)', clean, re.IGNORECASE)
    if fii_match:
        return fii_match.group(1).strip()
    
    return clean

def _search_brapi(search_term: str, asset_type: str = None) -> str | None:
    """Query brapi.dev to resolve a search term to a B3 ticker symbol."""
    try:
        # Strip accents for better API matching
        term = _strip_accents(search_term)
        params = {'search': term, 'limit': '1'}
        if asset_type:
            params['type'] = asset_type
        
        url = f"https://brapi.dev/api/quote/list?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            stocks = data.get('stocks', [])
            if stocks and len(stocks) > 0:
                return stocks[0].get('stock')
    except Exception as e:
        print(f"  [brapi] Search failed for '{search_term}': {e}")
    return None

def _is_valid_ticker(name: str) -> bool:
    """Check if a string already looks like a valid B3 ticker (e.g. PETR4, MXRF11, AAPL34)."""
    return bool(re.match(r'^[A-Z]{3,6}\d{1,2}$', name.upper().strip()))

def resolve_ticker(title_str: str, custom_tickers: dict = None) -> str:
    """Maps the full B3 name to the corresponding official ticker, using brapi.dev API."""
    clean = str(title_str).strip()
    
    # User's custom defined mappings take highest priority
    if custom_tickers:
        for name, ticker in custom_tickers.items():
            if clean.upper() == name.upper() or clean.upper().startswith(name.upper()):
                return ticker
                
    # If it already looks like a valid ticker, return it directly
    if _is_valid_ticker(clean):
        return clean.upper()
    
    # Check cache
    cache_key = clean.upper()
    if cache_key in _ticker_cache:
        return _ticker_cache[cache_key]
    
    # Detect asset type and extract search term
    asset_type = _detect_asset_type(clean)
    search_term = _extract_search_term(clean)
    
    # Strategy 1: Search with extracted keyword + asset type
    resolved = _search_brapi(search_term, asset_type)
    
    # Strategy 2: Search with keyword only (no type filter)
    if not resolved:
        resolved = _search_brapi(search_term)
    
    # Strategy 3: Try the full cleaned name (without suffixes) as search
    if not resolved:
        full_clean = re.sub(r'\s+(?:CI|DRN|BDR|PN|ON)\s*$', '', _strip_accents(clean)).strip()
        if full_clean != _strip_accents(search_term):
            resolved = _search_brapi(full_clean, asset_type)
            if not resolved:
                resolved = _search_brapi(full_clean)
    
    # Strategy 4: For FII/FIAGRO, try "FII <keyword>" as a search (some are listed that way)
    if not resolved and asset_type == 'fund':
        prefix = 'FIAGRO' if 'FIAGRO' in clean.upper() else 'FII'
        resolved = _search_brapi(f"{prefix} {_strip_accents(search_term)}")
    
    if resolved:
        print(f"  [brapi] Resolved '{clean}' -> {resolved}")
        _ticker_cache[cache_key] = resolved
        return resolved
    
    # Fallback: return the cleaned name
    print(f"  [brapi] Could not resolve '{clean}', keeping as-is")
    _ticker_cache[cache_key] = clean
    return clean

def categorize_ticker(ticker: str, original_name: str = '') -> str:
    """Classifica o tipo do ativo baseado no sufixo do ticker ou no nome original da B3."""
    # Special cases for ETFs
    if ticker in ['BOVA11', 'IVVB11', 'NDIV11']:
        return 'ETF'
        
    if ticker.endswith('11'): return 'FII'
    elif ticker.endswith('34'): return 'BDR'
    elif ticker.endswith('3') or ticker.endswith('4'): return 'Ações'
    
    # Fallback: use hints from the original B3 name for unresolved tickers
    if original_name:
        upper = original_name.upper()
        if 'DRN' in upper or 'BDR' in upper:
            return 'BDR'
        if 'FII' in upper or 'FIAGRO' in upper:
            return 'FII'
        if 'ISHARE' in upper or 'NU REND' in upper:
            return 'ETF'
        if ' PN' in upper or ' ON' in upper:
            return 'Ações'
    return 'Outro'

def parse_float(val) -> float:
    """Converte strings com vírgula para float de forma segura."""
    if pd.isna(val) or val == 'nan' or val == '':
        return 0.0
    if isinstance(val, str):
        val = val.replace('R$', '').replace('$', '').strip()
        val = val.replace('.', '').replace(',', '.')
    try:
        return float(val)
    except ValueError:
        return 0.0

def parse_date(date_val) -> str:
    """Converts and standardizes the date to YYYY-MM-DD."""
    if isinstance(date_val, datetime):
        return date_val.strftime('%Y-%m-%d')
    
    date_str = str(date_val).strip()
    try:
        if '/' in date_str:
            return datetime.strptime(date_str, '%d/%m/%Y').strftime('%Y-%m-%d')
        return str(date_str)[:10]
    except ValueError:
        return '1970-01-01'

# ==========================================
# MAIN EXTRACTION LOGIC
# ==========================================

def extract_trades(url: str, mappings: dict = None) -> list:
    """Reads the Google Sheets via CSV and returns the transactions."""
    try:
        df = pd.read_csv(url)
    except Exception as e:
        print(f"Error downloading data from Google Sheets: {e}")
        return []

    if not mappings:
        mappings = {}
        
    col_asset = mappings.get('mapAsset') or 'Especificação do Título'
    col_date = mappings.get('mapDate') or 'Data Pregão'
    col_type = mappings.get('mapType') or 'C/V'
    col_qty = mappings.get('mapQuantity') or 'Quantidade'
    col_price = mappings.get('mapPrice') or 'Preço (R$)'
    col_val = mappings.get('mapTotalValue') or 'Valor Operação (R$)'

    if col_asset not in df.columns:
        print(f"Error: Spreadsheet does not contain the header '{col_asset}'.")
        return []

    # Remove empty rows
    df = df.dropna(subset=[col_asset])

    trades = []
    for _, row in df.iterrows():
        raw_title = str(row[col_asset]).strip()
        if pd.isna(raw_title) or raw_title == 'nan':
            continue
            
        cv = str(row.get(col_type, '')).strip().upper()
        
        custom_buy = str(mappings.get('buyIndicator', '')).strip().upper()
        custom_sell = str(mappings.get('sellIndicator', '')).strip().upper()
        custom_div = str(mappings.get('dividendIndicator', '')).strip().upper()
        
        if custom_buy and cv == custom_buy:
            cv = 'C'
        elif custom_sell and cv == custom_sell:
            cv = 'V'
        elif custom_div and cv == custom_div:
            cv = 'D'
        else:
            if (not custom_buy) and cv in ['C', 'COMPRA', 'BUY', 'B']:
                cv = 'C'
            elif (not custom_sell) and cv in ['V', 'VENDA', 'SELL', 'S']:
                cv = 'V'
            elif (not custom_div) and cv in ['D', 'DIVIDENDO', 'RENDIMENTO', 'JCP', 'JUROS', 'R', 'AMORTIZACAO']:
                cv = 'D'
            else:
                continue
            
        date_val = row.get(col_date, '')
        ticker = resolve_ticker(raw_title, mappings.get('customTickers', {}))
        qty = parse_float(row.get(col_qty, 0))
        price = parse_float(row.get(col_price, 0))
        val_op = parse_float(row.get(col_val, 0))
        
        if val_op == 0:
            val_op = qty * price
            
        trades.append({
            'date': parse_date(date_val),
            'ticker': ticker,
            'category': categorize_ticker(ticker, raw_title),
            'side': cv,
            'qty': qty,
            'price': price,
            'value': val_op
        })
        
    # Sort chronologically before calculating dividends
    trades = sorted(trades, key=lambda t: t['date'])
    
    # Auto-calculate dividends from API based on historical quotas
    trades = calculate_auto_dividends(trades)
    
    return trades

def build_portfolio(trades: list) -> dict:
    """Calculates current position, average price, allocation, and temporal evolution."""
    holdings = defaultdict(lambda: {
        'buy_qty': 0, 'buy_value': 0,
        'sell_qty': 0, 'sell_value': 0,
        'net_qty': 0, 'total_cost': 0,
        'dividends': 0,
        'trades': 0, 'category': 'Outro'
    })

    monthly_net = defaultdict(float)
    monthly_buys = defaultdict(float)
    monthly_dividends = defaultdict(float)
    monthly_dividends_by_ticker = defaultdict(lambda: defaultdict(float))

    for trade in trades:
        ticker = trade['ticker']
        month = trade['date'][:7]
        
        # Consolidate Assets
        h = holdings[ticker]
        h['trades'] += 1
        h['category'] = trade['category']  # use category from trade (has original name fallback)

        if trade['side'] == 'C':
            h['buy_qty'] += trade['qty']
            h['buy_value'] += trade['value']
            h['net_qty'] += trade['qty']
            h['total_cost'] += trade['value']
            
            monthly_net[month] += trade['value']
            monthly_buys[month] += trade['value']
        elif trade['side'] == 'D':
            h['dividends'] += trade['value']
            monthly_dividends[month] += trade['value']
            monthly_dividends_by_ticker[ticker][month] += trade['value']
        else:
            held_qty = h['net_qty']
            h['sell_qty'] += trade['qty']
            h['sell_value'] += trade['value']
            h['net_qty'] -= trade['qty']
            
            if held_qty > 0:
                avg_cost = h['total_cost'] / held_qty
                cost_basis_sold = avg_cost * trade['qty']
                h['total_cost'] -= cost_basis_sold
                monthly_net[month] -= cost_basis_sold

    # Format JSON Output
    portfolio = []
    for ticker, h in sorted(holdings.items()):
        if h['net_qty'] <= 0 and h['dividends'] <= 0:
            continue
            
        avg_price = h['total_cost'] / h['net_qty'] if h['net_qty'] > 0 else 0
        portfolio.append({
            'ticker': ticker,
            'category': h['category'],
            'quotas': h['net_qty'],
            'avgPrice': round(avg_price, 2),
            'buyValue': round(h['buy_value'], 2),
            'sellValue': round(h['sell_value'], 2),
            'totalBuys': h['buy_qty'],
            'totalSells': h['sell_qty'],
            'trades': h['trades'],
            'dividends': round(h['dividends'], 2)
        })

    cumulative = 0
    monthly_evolution = []
    for month in sorted(monthly_net.keys()):
        cumulative += monthly_net[month]
        monthly_evolution.append({'month': month, 'value': round(cumulative, 2)})

    monthly_investments = [
        {'month': m, 'invested': round(v, 2)}
        for m, v in sorted(monthly_buys.items())
    ]
    
    monthly_divs = [
        {'month': m, 'dividends': round(v, 2)}
        for m, v in sorted(monthly_dividends.items())
    ]
    
    monthly_divs_by_ticker = {
        ticker: {m: round(v, 2) for m, v in sorted(months.items())}
        for ticker, months in monthly_dividends_by_ticker.items()
    }

    return {
        'holdings': portfolio,
        'monthlyEvolution': monthly_evolution,
        'monthlyInvestments': monthly_investments,
        'monthlyDividends': monthly_divs,
        'monthlyDividendsByTicker': monthly_divs_by_ticker,
        'trades': trades,
        'totalTrades': len(trades),
        'lastUpdate': trades[-1]['date'] if trades else None,
        'generatedAt': datetime.now().isoformat()
    }
