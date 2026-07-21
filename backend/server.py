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

FRONTEND_FOLDER = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend'))
app = Flask(__name__, static_folder=FRONTEND_FOLDER)
app.secret_key = os.environ.get('SECRET_KEY', 'super-secret-finance-key')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_FILE_DIR'] = os.path.join(os.path.dirname(__file__), 'flask_session')
app.config['SESSION_PERMANENT'] = True
Session(app)

GOOGLE_CLIENT_ID = '876883426728-c6e5peaq9cs01pm4h9g5335dds8ffkl8.apps.googleusercontent.com'

def normalize_sheet_url(sheet_url):
    if not sheet_url: return sheet_url
    sheet_url = sheet_url.strip()
    
    # Extract gid to support multiple tabs
    gid_match = re.search(r'[#&]?gid=(\d+)', sheet_url)
    gid_param = f"&gid={gid_match.group(1)}" if gid_match else ""

    if 'pubhtml' in sheet_url:
        sheet_url = re.sub(r'pubhtml.*', f'pub?output=csv{gid_param}', sheet_url)
    elif '/edit' in sheet_url:
        sheet_url = re.sub(r'/edit.*', f'/export?format=csv{gid_param}', sheet_url)
        
    return sheet_url

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    if os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
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
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "trace": traceback.format_exc()}), 500

@app.route('/api/user', methods=['GET'])
def get_user():
    user_id = session.get('user_id')
    if user_id:
        user = database.get_user_by_id(user_id)
        if user:
            portfolios = database.get_user_portfolios(user_id)
            user['portfolios'] = portfolios
            return jsonify(user)
    return jsonify({"error": "Not logged in"}), 401

@app.route('/api/user/settings', methods=['POST'])
def update_settings():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    data = request.json
    
    refresh_interval = data.get('refresh_interval', 3)
    theme = data.get('theme', 'theme-claude')
    default_chart_period = data.get('default_chart_period', '1y')
    
    database.update_user_settings(user_id, int(refresh_interval), theme, default_chart_period)
    return jsonify({"success": True, "refresh_interval": refresh_interval, "theme": theme, "default_chart_period": default_chart_period})

# ==========================================
# Portfolio Management Routes
# ==========================================

@app.route('/api/portfolios', methods=['POST'])
def create_portfolio():
    user_id = session.get('user_id')
    if not user_id: return jsonify({"error": "Not logged in"}), 401
    
    data = request.json
    name = data.get('name', 'New Portfolio').strip()
    sheet_url = normalize_sheet_url(data.get('sheet_url', ''))
    column_mappings = json.dumps(data.get('column_mappings')) if data.get('column_mappings') else None
    
    if not sheet_url:
        return jsonify({"error": "Sheet URL is required"}), 400
        
    new_id = database.create_portfolio(user_id, name, sheet_url, column_mappings)
    return jsonify({"success": True, "id": new_id})

@app.route('/api/portfolios/<int:portfolio_id>', methods=['PUT'])
def update_portfolio(portfolio_id):
    user_id = session.get('user_id')
    if not user_id: return jsonify({"error": "Not logged in"}), 401
    
    data = request.json
    name = data.get('name', 'Updated Portfolio').strip()
    sheet_url = normalize_sheet_url(data.get('sheet_url', ''))
    column_mappings = json.dumps(data.get('column_mappings')) if data.get('column_mappings') else None
    
    if not sheet_url:
        return jsonify({"error": "Sheet URL is required"}), 400
        
    database.update_portfolio(portfolio_id, user_id, name, sheet_url, column_mappings)
    return jsonify({"success": True})

@app.route('/api/portfolios/<int:portfolio_id>', methods=['DELETE'])
def delete_portfolio(portfolio_id):
    user_id = session.get('user_id')
    if not user_id: return jsonify({"error": "Not logged in"}), 401
    
    database.delete_portfolio(portfolio_id, user_id)
    return jsonify({"success": True})

@app.route('/api/user/active_portfolio', methods=['POST'])
def set_active_portfolio():
    user_id = session.get('user_id')
    if not user_id: return jsonify({"error": "Not logged in"}), 401
    
    portfolio_id = request.json.get('portfolio_id')
    if not portfolio_id:
        return jsonify({"error": "portfolio_id is required"}), 400
        
    database.set_active_portfolio(user_id, portfolio_id)
    return jsonify({"success": True})


# ==========================================
# Helpers & Utilities
# ==========================================

@app.route('/api/sheet/headers', methods=['POST'])
def get_sheet_headers():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    
    data = request.json
    sheet_url = normalize_sheet_url(data.get('sheet_url', ''))
    if not sheet_url:
        return jsonify({"error": "No URL provided"}), 400
        
    try:
        req = urllib.request.Request(sheet_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            content = response.read().decode('utf-8')
            reader = csv.reader(io.StringIO(content))
            headers = next(reader)
            # Remove empty columns
            headers = [h.strip() for h in headers if h.strip()]
            return jsonify({"success": True, "headers": headers, "normalized_url": sheet_url})
    except Exception as e:
        return jsonify({"error": f"Failed to fetch headers: {str(e)}"}), 400

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
# Core API Routes
# ==========================================

@app.route('/api/portfolio', methods=['GET'])
def get_portfolio_data():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({"error": "AUTH_REQUIRED", "message": "Please log in."}), 401
        
    user = database.get_user_by_id(user_id)
    active_portfolio_id = user.get('active_portfolio_id')
    
    if not active_portfolio_id:
        return jsonify({"error": "URL_REQUIRED", "message": "Please configure a portfolio."}), 400
        
    portfolio = database.get_portfolio(active_portfolio_id, user_id)
    if not portfolio or not portfolio.get('sheet_url'):
        return jsonify({"error": "URL_REQUIRED", "message": "Please configure a Google Sheet URL for this portfolio."}), 400

    url = portfolio['sheet_url']
    mappings_str = portfolio.get('column_mappings')
    mappings = json.loads(mappings_str) if mappings_str else None

    trades = extract_trades(url, mappings)
    if not trades:
        return jsonify({"error": "Failed to fetch data from Google Sheets"}), 500
    
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
