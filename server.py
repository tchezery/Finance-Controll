import os
from flask import Flask, send_from_directory, jsonify

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
# API Routes (Future integration for SQLite)
# ==========================================

@app.route('/api/portfolio', methods=['GET'])
def get_portfolio():
    # Por enquanto, serve o arquivo JSON estático
    # Futuramente lerá do banco de dados SQLite/Postgres
    if os.path.exists('portfolio_data.json'):
        return send_from_directory('.', 'portfolio_data.json')
    return jsonify({"error": "Data not found"}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
