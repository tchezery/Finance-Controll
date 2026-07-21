import subprocess
import os
import sys
import webbrowser
import time
import http.server
import socketserver
import threading

PORT = 8080

def run_extraction():
    print("⏳ Atualizando dados a partir do QUOTAS.xlsx...")
    # Executa o script de extração usando o python do ambiente atual
    result = subprocess.run([sys.executable, "extract.py"], capture_output=True, text=True)
    if result.returncode == 0:
        print("✅ Dados extraídos com sucesso!")
        print(result.stdout.strip())
    else:
        print("❌ Erro ao extrair dados:")
        print(result.stderr)

def start_server():
    Handler = http.server.SimpleHTTPRequestHandler
    # Permitir reuso da porta
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"🚀 Servidor rodando na porta {PORT}")
        print(f"Abra no navegador: http://localhost:{PORT}")
        httpd.serve_forever()

if __name__ == "__main__":
    # 1. Roda a extração dos dados
    run_extraction()
    
    # 2. Inicia o servidor em uma thread separada para não travar a execução
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()
    
    # 3. Espera 1 segundo para o servidor subir e abre o navegador automaticamente
    time.sleep(1)
    webbrowser.open(f"http://localhost:{PORT}/index.html")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        sys.exit(0)
