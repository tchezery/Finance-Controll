import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'finance_controll.db')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_id TEXT UNIQUE NOT NULL,
            email TEXT NOT NULL,
            name TEXT NOT NULL,
            sheet_url TEXT
        )
    ''')
    conn.commit()
    conn.close()

def get_user_by_google_id(google_id):
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE google_id = ?', (google_id,)).fetchone()
    conn.close()
    return dict(user) if user else None

def get_user_by_id(user_id):
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    conn.close()
    return dict(user) if user else None

def create_user(google_id, email, name):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO users (google_id, email, name) VALUES (?, ?, ?)',
        (google_id, email, name)
    )
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return get_user_by_id(user_id)

def update_sheet_url(user_id, sheet_url):
    conn = get_db_connection()
    conn.execute('UPDATE users SET sheet_url = ? WHERE id = ?', (sheet_url, user_id))
    conn.commit()
    conn.close()

# Initialize DB on import
init_db()
