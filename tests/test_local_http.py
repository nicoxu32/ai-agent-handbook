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
                    for endpoint in ['save', 'open-document', 'publish', 'followup']:
                        request = Request(address+'/api/local/'+endpoint, data=b'{}', headers={'Content-Type':'application/json', **headers})
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
            with patch('server.local_content.open_document', return_value={'opened':True}) as opened:
                request = Request(address+'/api/local/open-document', data=json.dumps({'group':'k02'}).encode(), headers={'Content-Type':'application/json','X-Handbook-Token':server.SESSION_TOKEN,'Origin':address})
                self.assertTrue(json.load(urlopen(request))['opened'])
                opened.assert_called_once_with(server.ROOT, 'k02')
            with patch('server.generate_followup', side_effect=server.RequestError(504, '模型响应超时')):
                request = Request(address+'/api/local/followup', data=b'{}', headers={'Content-Type':'application/json','X-Handbook-Token':server.SESSION_TOKEN,'Origin':address})
                with self.assertRaises(HTTPError) as caught:
                    urlopen(request)
                self.assertEqual(caught.exception.code, 504)
                caught.exception.close()
                self.assertTrue(server.GENERATION_SLOT.acquire(blocking=False))
                self.assertTrue(server.GENERATION_SLOT.acquire(blocking=False))
                server.GENERATION_SLOT.release()
                server.GENERATION_SLOT.release()

        finally:
            http.shutdown()
            http.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
