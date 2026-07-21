import psycopg
from psycopg.rows import dict_row
import os
from dotenv import load_dotenv

# Load env variables
load_dotenv()

def get_db_connection():
    return psycopg.connect(
        os.environ.get('DATABASE_URL'),
        row_factory=dict_row
    )

def init_db():
    try:
        conn = get_db_connection()
        conn.autocommit = True
        with conn.cursor() as cursor:
            # Users table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    google_id VARCHAR(255) UNIQUE NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    sheet_url TEXT,
                    column_mappings TEXT,
                    refresh_interval INT DEFAULT 3,
                    theme VARCHAR(50) DEFAULT 'theme-claude',
                    default_chart_period VARCHAR(20) DEFAULT '1y',
                    active_portfolio_id INT
                )
            ''')
            
            # Portfolios table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS portfolios (
                    id SERIAL PRIMARY KEY,
                    user_id INT REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR(255) NOT NULL,
                    sheet_url TEXT NOT NULL,
                    column_mappings TEXT
                )
            ''')

            # Ensure all columns exist (legacy schema updates)
            for col, col_type in [
                ('column_mappings', 'TEXT'),
                ('refresh_interval', 'INT DEFAULT 3'),
                ('theme', "VARCHAR(50) DEFAULT 'theme-claude'"),
                ('default_chart_period', "VARCHAR(20) DEFAULT '1y'"),
                ('active_portfolio_id', 'INT')
            ]:
                cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = %s", (col,))
                if not cursor.fetchone():
                    cursor.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
            
            # Perform Migration: Move legacy sheet_url to portfolios table for users who don't have portfolios yet
            cursor.execute("SELECT id, sheet_url, column_mappings FROM users WHERE sheet_url IS NOT NULL AND sheet_url != ''")
            legacy_users = cursor.fetchall()
            for u in legacy_users:
                cursor.execute("SELECT id FROM portfolios WHERE user_id = %s", (u['id'],))
                if not cursor.fetchone():
                    # Create default portfolio
                    cursor.execute(
                        "INSERT INTO portfolios (user_id, name, sheet_url, column_mappings) VALUES (%s, %s, %s, %s) RETURNING id",
                        (u['id'], 'My Portfolio', u['sheet_url'], u['column_mappings'])
                    )
                    new_portfolio_id = cursor.fetchone()['id']
                    cursor.execute("UPDATE users SET active_portfolio_id = %s, sheet_url = NULL WHERE id = %s", (new_portfolio_id, u['id']))

        conn.close()
    except Exception as e:
        print(f"Failed to initialize database: {e}")

def get_user_by_google_id(google_id):
    conn = get_db_connection()
    with conn.cursor() as cursor:
        cursor.execute('SELECT * FROM users WHERE google_id = %s', (google_id,))
        user = cursor.fetchone()
    conn.close()
    return user

def get_user_by_id(user_id):
    conn = get_db_connection()
    with conn.cursor() as cursor:
        cursor.execute('SELECT * FROM users WHERE id = %s', (user_id,))
        user = cursor.fetchone()
    conn.close()
    return user

def create_user(google_id, email, name):
    conn = get_db_connection()
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute(
            'INSERT INTO users (google_id, email, name) VALUES (%s, %s, %s) RETURNING id',
            (google_id, email, name)
        )
        user_id = cursor.fetchone()['id']
    conn.close()
    return get_user_by_id(user_id)

def update_user_settings(user_id, refresh_interval, theme, default_chart_period='1y'):
    conn = get_db_connection()
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute(
            'UPDATE users SET refresh_interval = %s, theme = %s, default_chart_period = %s WHERE id = %s',
            (refresh_interval, theme, default_chart_period, user_id)
        )
    conn.close()

# Portfolio Methods
def get_user_portfolios(user_id):
    conn = get_db_connection()
    with conn.cursor() as cursor:
        cursor.execute('SELECT * FROM portfolios WHERE user_id = %s ORDER BY id ASC', (user_id,))
        portfolios = cursor.fetchall()
    conn.close()
    return portfolios

def get_portfolio(portfolio_id, user_id):
    conn = get_db_connection()
    with conn.cursor() as cursor:
        cursor.execute('SELECT * FROM portfolios WHERE id = %s AND user_id = %s', (portfolio_id, user_id))
        portfolio = cursor.fetchone()
    conn.close()
    return portfolio

def create_portfolio(user_id, name, sheet_url, column_mappings=None):
    conn = get_db_connection()
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute(
            'INSERT INTO portfolios (user_id, name, sheet_url, column_mappings) VALUES (%s, %s, %s, %s) RETURNING id',
            (user_id, name, sheet_url, column_mappings)
        )
        new_id = cursor.fetchone()['id']
        
        # If it's their first portfolio, make it active
        cursor.execute('SELECT active_portfolio_id FROM users WHERE id = %s', (user_id,))
        user = cursor.fetchone()
        if not user.get('active_portfolio_id'):
            cursor.execute('UPDATE users SET active_portfolio_id = %s WHERE id = %s', (new_id, user_id))
            
    conn.close()
    return new_id

def update_portfolio(portfolio_id, user_id, name, sheet_url, column_mappings):
    conn = get_db_connection()
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute(
            'UPDATE portfolios SET name = %s, sheet_url = %s, column_mappings = %s WHERE id = %s AND user_id = %s',
            (name, sheet_url, column_mappings, portfolio_id, user_id)
        )
    conn.close()

def delete_portfolio(portfolio_id, user_id):
    conn = get_db_connection()
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute('DELETE FROM portfolios WHERE id = %s AND user_id = %s', (portfolio_id, user_id))
        
        # If they deleted their active portfolio, fallback to the first one available or null
        cursor.execute('SELECT active_portfolio_id FROM users WHERE id = %s', (user_id,))
        user = cursor.fetchone()
        if user and user['active_portfolio_id'] == int(portfolio_id):
            cursor.execute('SELECT id FROM portfolios WHERE user_id = %s ORDER BY id ASC LIMIT 1', (user_id,))
            first = cursor.fetchone()
            new_active_id = first['id'] if first else None
            cursor.execute('UPDATE users SET active_portfolio_id = %s WHERE id = %s', (new_active_id, user_id))
    conn.close()

def set_active_portfolio(user_id, portfolio_id):
    conn = get_db_connection()
    conn.autocommit = True
    with conn.cursor() as cursor:
        # verify portfolio exists and belongs to user
        cursor.execute('SELECT id FROM portfolios WHERE id = %s AND user_id = %s', (portfolio_id, user_id))
        if cursor.fetchone():
            cursor.execute('UPDATE users SET active_portfolio_id = %s WHERE id = %s', (portfolio_id, user_id))
    conn.close()

# Initialize DB on import
init_db()
