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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
