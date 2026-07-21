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
                    default_chart_period VARCHAR(20) DEFAULT '1y'
                )
            ''')
            
            # Check column_mappings
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'column_mappings'")
            if not cursor.fetchone():
                cursor.execute('ALTER TABLE users ADD COLUMN column_mappings TEXT')
                
            # Check refresh_interval
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'refresh_interval'")
            if not cursor.fetchone():
                cursor.execute('ALTER TABLE users ADD COLUMN refresh_interval INT DEFAULT 3')
                
            # Check theme
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'theme'")
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE users ADD COLUMN theme VARCHAR(50) DEFAULT 'theme-claude'")

            # Check default_chart_period
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'default_chart_period'")
            if not cursor.fetchone():
                cursor.execute("ALTER TABLE users ADD COLUMN default_chart_period VARCHAR(20) DEFAULT '1y'")

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

def update_user_settings(user_id, sheet_url, column_mappings, refresh_interval, theme, default_chart_period='1y'):
    conn = get_db_connection()
    conn.autocommit = True
    with conn.cursor() as cursor:
        cursor.execute(
            'UPDATE users SET sheet_url = %s, column_mappings = %s, refresh_interval = %s, theme = %s, default_chart_period = %s WHERE id = %s',
            (sheet_url, column_mappings, refresh_interval, theme, default_chart_period, user_id)
        )
    conn.close()

# Initialize DB on import
init_db()
