import os
import json
import urllib.request
import time
from datetime import datetime
from collections import defaultdict

CACHE_FILE = os.path.join(os.path.dirname(__file__), 'dividends_cache.json')
CACHE_EXPIRY_DAYS = 1

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
                # Check expiration globally or per ticker
                last_updated = data.get('_last_updated', 0)
                if time.time() - last_updated > CACHE_EXPIRY_DAYS * 86400:
                    return {}
                return data.get('tickers', {})
        except Exception as e:
            print(f"Error loading dividend cache: {e}")
    return {}

def save_cache(tickers_data):
    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump({
                '_last_updated': time.time(),
                'tickers': tickers_data
            }, f)
    except Exception as e:
        print(f"Error saving dividend cache: {e}")

def fetch_dividend_history(ticker):
    """Fetches historical dividends for a ticker from Yahoo Finance."""
    # Yahoo Finance format for B3 is usually TICKER.SA
    yf_ticker = f"{ticker}.SA"
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_ticker}?range=10y&interval=1mo&events=div"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            
            result = data.get('chart', {}).get('result', [])
            if not result:
                return {}
                
            events = result[0].get('events', {}).get('dividends', {})
            return events
    except Exception as e:
        print(f"Error fetching dividends for {ticker}: {e}")
        return {}

def get_all_dividends(tickers):
    """Gets dividends for all tickers, using cache if available."""
    cache = load_cache()
    updated = False
    
    for ticker in tickers:
        if ticker not in cache:
            print(f"Fetching dividends for {ticker}...")
            cache[ticker] = fetch_dividend_history(ticker)
            updated = True
            time.sleep(0.5) # Be nice to the API
            
    if updated:
        save_cache(cache)
        
    return cache

def calculate_auto_dividends(trades):
    """
    Given a list of trades, calculates the dividends earned based on 
    the running balance of quotas on the ex-dividend date.
    Injects these dividends back into the trades list.
    """
    if not trades:
        return trades
        
    # Find all unique tickers
    tickers = set(t['ticker'] for t in trades if t['side'] in ['C', 'V'])
    
    # Fetch all dividend histories
    div_data = get_all_dividends(tickers)
    
    # Build a daily ledger for each asset
    sorted_trades = sorted(trades, key=lambda x: x['date'])
    
    balance_history = defaultdict(list) # ticker -> [(date, balance), ...]
    current_balances = defaultdict(float)
    
    for trade in sorted_trades:
        ticker = trade['ticker']
        if trade['side'] == 'C':
            current_balances[ticker] += trade['qty']
        elif trade['side'] == 'V':
            current_balances[ticker] -= trade['qty']
        else:
            continue
            
        balance_history[ticker].append((trade['date'], current_balances[ticker]))
        
    auto_dividends = []
    
    for ticker, history in div_data.items():
        if not history:
            continue
            
        events = sorted(history.values(), key=lambda x: x['date'])
        
        b_history = balance_history.get(ticker, [])
        if not b_history:
            continue
            
        for event in events:
            # Ex-date
            ex_date_dt = datetime.fromtimestamp(event['date'])
            ex_date_str = ex_date_dt.strftime('%Y-%m-%d')
            amount = event['amount']
            
            applicable_balance = 0
            for trade_date, balance in b_history:
                if trade_date < ex_date_str:
                    applicable_balance = balance
                else:
                    break
                    
            if applicable_balance > 0:
                total_dividend = applicable_balance * amount
                auto_dividends.append({
                    'date': ex_date_str, 
                    'ticker': ticker,
                    'category': next((t['category'] for t in sorted_trades if t['ticker'] == ticker), 'Outro'),
                    'side': 'D',
                    'qty': applicable_balance,
                    'price': amount,
                    'value': total_dividend,
                    'auto_calculated': True
                })
                
    all_trades = sorted(trades + auto_dividends, key=lambda x: x['date'])
    return all_trades
