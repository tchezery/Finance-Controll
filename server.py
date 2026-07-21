import os
from flask import Flask, send_from_directory, jsonify
from extract import extract_trades, build_portfolio, SHEETS_URL

app = Flask(__name__, static_folder='.')

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    if os.path.exists(path):
        return send_from_directory('.', path)
    return "Not Found", 404

# ==========================================
# API Routes
# ==========================================

@app.route('/api/portfolio', methods=['GET'])
def get_portfolio():
    # Agora puxa os dados em tempo real da planilha do Google!
    trades = extract_trades(SHEETS_URL)
    if not trades:
        return jsonify({"error": "Falha ao puxar dados do Google Sheets"}), 500
    
    dashboard_data = build_portfolio(trades)
    return jsonify(dashboard_data)

import urllib.request
import json

@app.route('/api/history/<ticker>', methods=['GET'])
def get_history(ticker):
    try:
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}.SA?range=5y&interval=1d"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            result = data.get('chart', {}).get('result', [])
            if not result:
                return jsonify([])
            timestamps = result[0].get('timestamp', [])
            quote = result[0].get('indicators', {}).get('quote', [{}])[0]
            closes = quote.get('close', [])
            
            history = []
            for t, c in zip(timestamps, closes):
                if c is not None:
                    history.append({"date": t, "close": c})
            return jsonify(history)
    except Exception as e:
        print(f"Error fetching history for {ticker}: {e}")
        return jsonify([])

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
