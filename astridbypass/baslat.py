import http.server
import socketserver
import webbrowser
import threading
import time

PORT = 3000

def open_browser():
    time.sleep(0.8)
    webbrowser.open(f'http://localhost:{PORT}')

print('========================================================')
print('              ASTRID BYPASS YEREL SUNUCU                ')
print('========================================================')
print(f'Port {PORT} üzerinde sunucu başlatılıyor...')
print(f'Tarayıcı açılıyor: http://localhost:{PORT}')
print('Durdurmak için Ctrl + C tuşlarına basın.')
print('--------------------------------------------------------')

threading.Thread(target=open_browser, daemon=True).start()

Handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nSunucu durduruldu.')
