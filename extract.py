import pandas as pd
import json
import re
from collections import defaultdict
from datetime import datetime

# ==========================================
# CONFIGURATION & MAPPINGS
# ==========================================

EXCEL_FILE = 'QUOTAS.xlsx'
SHEET_NAME = 'Página1'
OUTPUT_JSON = 'portfolio_data.json'

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
    """Mapeia o nome completo da B3 para o Ticker oficial correspondente."""
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
    """Converte e padroniza a data para YYYY-MM-DD."""
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

def extract_trades(file_path: str, sheet_name: str) -> list:
    """Lê a planilha e retorna uma lista de dicionários representando as transações."""
    try:
        df = pd.read_excel(file_path, sheet_name=sheet_name)
    except FileNotFoundError:
        print(f"Erro: Arquivo {file_path} não encontrado.")
        return []

    col_title = 'Especificação do Título'
    if col_title not in df.columns:
        print("Erro: Planilha não possui o cabeçalho padrão da B3.")
        return []

    # Remove linhas vazias
    df = df.dropna(subset=[col_title])

    trades = []
    for _, row in df.iterrows():
        raw_title = str(row[col_title]).strip()
        if pd.isna(raw_title) or raw_title == 'nan':
            continue
            
        cv = str(row.get('C/V', '')).strip().upper()
        if cv not in ['C', 'V']:
            continue
            
        date_val = row.get('Data Pregão', '')
        ticker = resolve_ticker(raw_title)
        qty = parse_float(row.get('Quantidade', 0))
        price = parse_float(row.get('Preço (R$)', 0))
        val_op = parse_float(row.get('Valor Operação (R$)', 0))
        
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
        
    # Ordena cronologicamente
    return sorted(trades, key=lambda t: t['date'])

def build_portfolio(trades: list) -> dict:
    """Calcula posição atual, preço médio, alocação e evolução temporal."""
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
        
        # Consolida Ativos
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

    # Formata Saída JSON
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
    print(f"Lendo dados de {EXCEL_FILE}...")
    trades = extract_trades(EXCEL_FILE, SHEET_NAME)
    
    if not trades:
        print("Nenhuma transação encontrada.")
        return
        
    dashboard_data = build_portfolio(trades)

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(dashboard_data, f, indent=2, ensure_ascii=False)

    print(f"✅ Sucesso! Extraídas {len(trades)} operações.")
    print(f"✅ {len(dashboard_data['holdings'])} ativos na carteira.")
    print(f"✅ Arquivo {OUTPUT_JSON} atualizado com sucesso!")

if __name__ == '__main__':
    main()
