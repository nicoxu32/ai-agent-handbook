"""Open an existing local handbook or start it on an available loopback port."""
import json
import threading
from urllib.request import ProxyHandler, build_opener
import webbrowser
from http.server import ThreadingHTTPServer
from server import HandbookHandler


def main():
    opener = build_opener(ProxyHandler({}))
    for port in range(8767, 8778):
        url = f'http://127.0.0.1:{port}'
        try:
            with opener.open(url + '/api/local/status', timeout=1) as response:
                status = json.load(response)
            if status.get('app') == 'nico-handbook-local-v1':
                webbrowser.open(url)
                print('已打开正在运行的本地学习手册。')
                return
        except Exception:
            pass
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), HandbookHandler)
        except OSError:
            continue
        print(f'本地学习手册：{url}\n保持此窗口运行；按 Ctrl+C 关闭服务。', flush=True)
        threading.Timer(.5, lambda: webbrowser.open(url)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return
    raise SystemExit('没有可用端口，请关闭旧的本地服务后重试。')


if __name__ == '__main__':
    main()
