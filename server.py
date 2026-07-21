import os
import json
import io
import csv
import urllib.request
import re
from flask import Flask, send_from_directory, jsonify, request, session, Response
from flask_session import Session
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from extract import extract_trades, build_portfolio, SHEETS_URL
import database

app = Flask(__name__, static_folder='.')
app.secret_key = os.environ.get('SECRET_KEY', 'super-secret-finance-key')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_PERMANENT'] = True
Session(app)

GOOGLE_CLIENT_ID = '876883426728-c6e5peaq9cs01pm4h9g5335dds8ffkl8.apps.googleusercontent.com'

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    if os.path.exists(path):
        return send_from_directory('.', path)
    return "Not Found", 404

# ==========================================
# Authentication & User Routes
# ==========================================

@app.route('/api/auth/google', methods=['POST'])
def auth_google():
    token = request.json.get('credential')
    try:
        idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
        google_id = idinfo['sub']
        email = idinfo['email']
        name = idinfo.get('name', '')
        
        user = database.get_user_by_google_id(google_id)
        if not user:
            user = database.create_user(google_id, email, name)
            
        session['user_id'] = user['id']
        return jsonify({"success": True, "user": user})
    except ValueError as e:
        return jsonify({"error": "Invalid token"}), 401

@app.route('/api/user', methods=['GET'])
def get_user():
    user_id = session.get('user_id')
    if user_id:
        user = database.get_user_by_id(user_id)
        if user:
            return jsonify(user)
    return jsonify({"error": "Not logged in"}), 401

@app.route('/api/user/settings', methods=['POST'])
def update_settings():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    data = request.json
    sheet_url = data.get('sheet_url', '').strip()
    
    # Normalize Google Sheets URL to CSV format
    if 'pubhtml' in sheet_url:
        sheet_url = sheet_url.replace('pubhtml', 'pub?output=csv')
    elif '/edit' in sheet_url:
        sheet_url = re.sub(r'/edit.*', '/export?format=csv', sheet_url)

    column_mappings = data.get('column_mappings')
    mappings_str = json.dumps(column_mappings) if column_mappings else None
    refresh_interval = data.get('refresh_interval', 3)
    
    database.update_user_settings(user_id, sheet_url, mappings_str, int(refresh_interval))
    return jsonify({"success": True, "sheet_url": sheet_url, "column_mappings": column_mappings, "refresh_interval": refresh_interval})

@app.route('/api/template', methods=['GET'])
def download_template():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Data Pregão', 'Nº Nota', 'C/V', 'Tipo Mercado', 'Especificação do Título', 'Quantidade', 'Preço (R$)', 'Valor Operação (R$)'])
    writer.writerow(['15/01/2026', '123456', 'C', 'Mercado à Vista', 'PETROBRAS PN N2', '100', '35.50', '3550.00'])
    writer.writerow(['16/01/2026', '123457', 'V', 'Mercado à Vista', 'FII MAXI REN', '50', '10.20', '510.00'])
    
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-disposition": "attachment; filename=modelo_investimentos.csv"}
    )

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    return jsonify({"success": True})

# ==========================================
# API Routes
# ==========================================

@app.route('/api/portfolio', methods=['GET'])
def get_portfolio():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "AUTH_REQUIRED", "message": "Please log in."}), 401
        
    user = database.get_user_by_id(user_id)
    if not user.get('sheet_url'):
        return jsonify({"error": "URL_REQUIRED", "message": "Please configure your Google Sheet URL."}), 400

    url = user['sheet_url']
    mappings_str = user.get('column_mappings')
    mappings = json.loads(mappings_str) if mappings_str else None

    trades = extract_trades(url, mappings)
    if not trades:
        return jsonify({"error": "Falha ao puxar dados do Google Sheets"}), 500
    
    dashboard_data = build_portfolio(trades)
    return jsonify(dashboard_data)

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
