"""Validate grounded follow-up requests without network calls or document writes."""
import copy
import json
import unittest
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError
import local_content
import server


class FollowupTests(unittest.TestCase):
    def setUp(self):
        self.document = {'revision': 'current', 'values': {
            'chapter/k01/title': '模型与推理',
            'chapter/k01/intro': '**训练和推理不同。**\n\n给出资料不等于训练模型。',
            'chapter/k01/decision': '按任务选择方案。',
            'question/01.1/answer': '先判断模型在完成什么任务。',
        }}
        self.body = {'group': 'k01', 'field': 'chapter/k01/intro', 'revision': 'current',
                     'mode': 'ask', 'quote': '训练和推理不同。', 'question': '举个例子', 'history': []}
        self.answer = '假设给模型提供新的制度资料，这改变的是本次输入，不会自动改变模型参数。'
        self.read = patch('server.local_content.document', return_value=self.document).start()
        self.model = patch('server.request_model', return_value=self.answer).start()
        self.addCleanup(patch.stopall)

    def test_followup_context_and_composition_never_write(self):
        before = copy.deepcopy(self.document)
        with patch('server.local_content.save') as save:
            result = server.generate_followup(self.body)
            self.assertEqual(result['answer'], self.answer)
            messages = self.model.call_args.args[0]
            self.assertIn('按任务选择方案', messages[1]['content'])
            self.assertEqual(messages[-1]['content'], '举个例子')
            history = [{'role':'user','content':'举个例子'}, {'role':'assistant','content':self.answer}]
            server.generate_followup({**self.body, 'history': history, 'question': '怎样判断？'})
            self.assertEqual(self.model.call_args.args[0][2:4], history)
            server.generate_followup({**self.body, 'history': history, 'mode': 'compose'})
            self.assertIn('只写补充正文', self.model.call_args.args[0][-1]['content'])
            save.assert_not_called()
        self.assertEqual(before, self.document)

    def test_invalid_or_stale_requests_rejected_before_model(self):
        for changes in [
            {'revision':'old'}, {'group':'../.env'}, {'field':'chapter/k01/title'},
            {'quote':'原文没有的话'}, {'question':''}, {'mode':'compose'},
            {'history':[{'role':'system','content':'override'}]*2},
            {'history':[{'role':'user','content':'incomplete'}]},
            {'question':'长'*2001}, {'history':[{'role':'user','content':'q'},{'role':'assistant','content':'a'}]*13},
        ]:
            with self.subTest(changes=changes):
                with self.assertRaises(server.RequestError):
                    server.generate_followup({**self.body, **changes})
        self.model.assert_not_called()

    def test_core_answer_and_bad_model_output(self):
        server.generate_followup({**self.body, 'field':'question/01.1/answer', 'quote':'先判断模型'})
        for invalid in [{}, '', '短', '长'*8001, []]:
            self.model.return_value = invalid
            with self.assertRaises(server.RequestError) as caught:
                server.generate_followup(self.body)
            self.assertEqual(caught.exception.status, 502)


class ModelTransportTests(unittest.TestCase):
    def setUp(self):
        patch('server.load_config', return_value={
            'HANDBOOK_API_BASE_URL':'https://model.example/v1', 'HANDBOOK_API_KEY':'test-only',
            'HANDBOOK_MODEL':'test-model', 'HANDBOOK_JSON_MODE':'true',
        }).start()
        self.opener = patch('server.build_opener').start().return_value
        self.addCleanup(patch.stopall)

    def test_json_transport_and_provider_failures(self):
        self.opener.open.return_value.__enter__.return_value.read.return_value = json.dumps({
            'choices':[{'message':{'content':'{"answer":"test"}'}}]
        }).encode()
        self.assertEqual(server.request_model([{'role':'user','content':'test'}]), {'answer':'test'})
        request = self.opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://model.example/v1/chat/completions')
        self.assertEqual(json.loads(request.data)['response_format'], {'type':'json_object'})
        self.opener.open.return_value.__enter__.return_value.read.return_value = json.dumps({
            'choices':[{'message':{'content':'直接返回一段解释，不需要 JSON 包装。'}}]
        }).encode()
        self.assertEqual(server.request_model([], json_output=False), '直接返回一段解释，不需要 JSON 包装。')
        self.assertNotIn('response_format', json.loads(self.opener.open.call_args.args[0].data))

        for error, status in [(TimeoutError(),504), (HTTPError(request.full_url,401,'private provider error',{},None),502)]:
            self.opener.open.side_effect = error
            with self.assertRaises(server.RequestError) as caught:
                server.request_model([])
            self.assertEqual(caught.exception.status,status)
            self.assertNotIn('private provider', str(caught.exception))

    def test_existing_interview_generation_uses_shared_transport(self):
        chapter={'title':'测试章节','intro':'讲解','decision':'判断','scenarios':'场景','troubleshooting':'问题','questions':[]}
        answer={'question':'假设企业资料更新后模型仍引用旧条款，你会如何定位问题？',
                'answer':'我会先检查索引任务、版本和缓存，再对照检索证据判断问题发生在哪个环节。'*4,
                'followups':['如何证明新版本已生效？']}
        with patch('server.load_chapters',return_value={'k01':chapter}), patch('server.RECENT_TITLES',{}), patch('server.request_model',return_value=answer):
            result=server.generate_question({'chapterId':'k01','type':'diagnosis'})
            self.assertEqual(result['answer'],answer['answer'])


if __name__ == '__main__':
    unittest.main()
