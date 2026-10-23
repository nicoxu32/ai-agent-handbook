"""Ensure file mutations require loopback host, same origin and session token."""
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import server


class LocalHTTPTests(unittest.TestCase):
    def test_write_guards_and_no_arbitrary_file_routes(self):
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.HandbookHandler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        address = f'http://127.0.0.1:{http.server_port}'
        try:
            for headers in [
                {},
                {'X-Handbook-Token': server.SESSION_TOKEN, 'Origin': 'https://example.org'},
                {'X-Handbook-Token': server.SESSION_TOKEN, 'Host': 'attacker.example'},
                {'X-Handbook-Token': server.SESSION_TOKEN, 'Sec-Fetch-Site': 'cross-site'},
            ]:
                with self.subTest(headers=list(headers)):
                    request = Request(address+'/api/local/save', data=b'{}', headers={'Content-Type':'application/json', **headers})
                    with self.assertRaises(HTTPError) as caught:
                        urlopen(request)
                    self.assertEqual(caught.exception.code, 403)
                    caught.exception.close()
            for path in ['/.env', '/content/documents/k01.md', '/../.env']:
                with self.assertRaises(HTTPError) as caught:
                    urlopen(address+path)
                self.assertEqual(caught.exception.code, 404)
                caught.exception.close()
            with patch('server.local_content.document', return_value={'values':{},'revision':'test'}) as read:
                request = Request(address+'/api/local/document', data=json.dumps({'group':'k01'}).encode(), headers={'Content-Type':'application/json','X-Handbook-Token':server.SESSION_TOKEN,'Origin':address})
                self.assertEqual(json.load(urlopen(request))['revision'], 'test')
                read.assert_called_once_with(server.ROOT, 'k01')
        finally:
            http.shutdown()
            http.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
