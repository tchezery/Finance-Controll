import pandas as pd
import json
import re
from collections import defaultdict
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ==========================================
# CONFIGURATION & MAPPINGS
# ==========================================

SHEETS_URL = os.getenv('SHEETS_URL')

OUTPUT_JSON = os.path.join(os.path.dirname(__file__), 'portfolio_data.json')


TITLE_TO_TICKER = {
    'FII MAXI REN': 'MXRF11',
    'FII GUARDIAN': 'GARE11',
    'FII BTG CRI': 'BTCI11',
    'FIAGRO FGA': 'FGAA11',
    'FIAGRO SUNO': 'SNAG11',
    'FII PVBI VBI': 'PVBI11',
    'FII VBI PRI': 'PVBI11',
    'FII VALREIII': 'VGIR11',
    'FII VALREIJI': 'VGIR11',
    'FII HSI MALL': 'HSML11',
    'FII XP MALLS': 'XPML11',
    'FII BTLG': 'BTLG11',
    'ISHARES BOVA': 'BOVA11',
    'ISHARE SP500': 'IVVB11',
    'NU REND IBOV': 'NDIV11',
    'PETROBRAS PN': 'PETR4',
    'BRADESCO PN': 'BBDC4',
    'BRASIL ON': 'BBAS3',
    'GERDAU PN': 'GGBR4',
    'APPLE DRN': 'AAPL34',
    'AMAZON DRN': 'AMZO34',
}

# ==========================================
# HELPER FUNCTIONS
# ==========================================

def resolve_ticker(title_str: str) -> str:
    """Maps the full B3 name to the corresponding official Ticker."""
    clean = str(title_str).strip()
    
    # Remove sufixos comuns da B3
    title_clean = re.sub(r'\s+(?:CI\s+)?(?:ER[A]?|ES|EJ|ED|ATZ|D)?\s*(?:[@#]+)?\s*$', '', clean)
    title_clean = re.sub(r'\s+(?:N[12M]+|CI)\s*$', '', title_clean)
    title_clean = re.sub(r'\s+(?:CI)\s*$', '', title_clean)
    title_clean = title_clean.strip()
    
    # Busca pela string mais longa que dá match (evita falsos positivos)
    for title, ticker in sorted(TITLE_TO_TICKER.items(), key=lambda x: -len(x[0])):
        if title_clean.startswith(title):
            return ticker
    return clean

def categorize_ticker(ticker: str) -> str:
    """Classifica o tipo do ativo baseado no sufixo do ticker."""
    if ticker.endswith('11'): return 'FII'
    elif ticker.endswith('34'): return 'BDR'
    elif ticker.endswith('3') or ticker.endswith('4'): return 'Ações'
    return 'Outro'

def parse_float(val) -> float:
    """Converte strings com vírgula para float de forma segura."""
    if pd.isna(val) or val == 'nan' or val == '':
        return 0.0
    if isinstance(val, str):
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
        if cv in ['C', 'COMPRA', 'BUY', 'B']:
            cv = 'C'
        elif cv in ['V', 'VENDA', 'SELL', 'S']:
            cv = 'V'
        else:
            continue
            
        date_val = row.get(col_date, '')
        ticker = resolve_ticker(raw_title)
        qty = parse_float(row.get(col_qty, 0))
        price = parse_float(row.get(col_price, 0))
        val_op = parse_float(row.get(col_val, 0))
        
        if val_op == 0:
            val_op = qty * price
            
        trades.append({
            'date': parse_date(date_val),
            'ticker': ticker,
            'category': categorize_ticker(ticker),
            'side': 'C' if cv == 'C' else 'V',
            'qty': qty,
            'price': price,
            'value': val_op
        })
        
    # Sort chronologically
    return sorted(trades, key=lambda t: t['date'])

def build_portfolio(trades: list) -> dict:
    """Calculates current position, average price, allocation, and temporal evolution."""
    holdings = defaultdict(lambda: {
        'buy_qty': 0, 'buy_value': 0,
        'sell_qty': 0, 'sell_value': 0,
        'net_qty': 0, 'total_cost': 0,
        'trades': 0
    })

    monthly_net = defaultdict(float)
    monthly_buys = defaultdict(float)

    for trade in trades:
        ticker = trade['ticker']
        month = trade['date'][:7]
        
        # Consolidate Assets
        h = holdings[ticker]
        h['trades'] += 1

        if trade['side'] == 'C':
            h['buy_qty'] += trade['qty']
            h['buy_value'] += trade['value']
            h['net_qty'] += trade['qty']
            h['total_cost'] += trade['value']
            
            monthly_net[month] += trade['value']
            monthly_buys[month] += trade['value']
        else:
            h['sell_qty'] += trade['qty']
            h['sell_value'] += trade['value']
            h['net_qty'] -= trade['qty']
            monthly_net[month] -= trade['value']
            
            if h['buy_qty'] > 0:
                avg_cost = h['total_cost'] / h['buy_qty']
                h['total_cost'] -= avg_cost * trade['qty']

    # Format JSON Output
    portfolio = []
    for ticker, h in sorted(holdings.items()):
        if h['net_qty'] <= 0:
            continue
            
        avg_price = h['total_cost'] / h['net_qty'] if h['net_qty'] > 0 else 0
        portfolio.append({
            'ticker': ticker,
            'category': categorize_ticker(ticker),
            'quotas': h['net_qty'],
            'avgPrice': round(avg_price, 2),
            'buyValue': round(h['buy_value'], 2),
            'sellValue': round(h['sell_value'], 2),
            'totalBuys': h['buy_qty'],
            'totalSells': h['sell_qty'],
            'trades': h['trades']
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

    return {
        'holdings': portfolio,
        'monthlyEvolution': monthly_evolution,
        'monthlyInvestments': monthly_investments,
        'trades': trades,
        'totalTrades': len(trades),
        'lastUpdate': trades[-1]['date'] if trades else None,
        'generatedAt': datetime.now().isoformat()
    }

def main():
    print("Downloading data from Google Sheets...")
    trades = extract_trades(SHEETS_URL)
    
    if not trades:
        print("No transactions found.")
        return
        
    dashboard_data = build_portfolio(trades)

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(dashboard_data, f, indent=2, ensure_ascii=False)

    print(f"✅ Success! Extracted {len(trades)} operations.")
    print(f"✅ {len(dashboard_data['holdings'])} assets in portfolio.")
    print(f"✅ File {OUTPUT_JSON} updated successfully!")

if __name__ == '__main__':
    main()
