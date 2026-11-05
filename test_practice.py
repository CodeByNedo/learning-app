import copy
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

import app
import practice


def text_pdf(text='TCP provides reliable ordered delivery of a stream of bytes.'):
    """Small real PDF in memory; no user documents or network calls."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    stream = DecodedStreamObject()
    stream.set_data(('BT /F1 12 Tf 40 700 Td (' + text + ') Tj ET').encode('ascii'))
    page[NameObject('/Contents')] = stream
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class PracticeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original = app.DATA
        with __import__('contextlib').closing(sqlite3.connect(app.DATA / 'learning.sqlite3')) as source, __import__('contextlib').closing(sqlite3.connect(Path(self.temp.name) / 'learning.sqlite3')) as target:
            source.backup(target)
        app.DATA = Path(self.temp.name)
        self.client = app.app.test_client()
        self.client.post('/api/subjects', json={'name': 'Practice test'})
        self.subject = self.client.get('/api/state').json['subjects'][-1]['id']
        self.collection = self.client.post('/api/practice/collections', json={'name': 'Exam', 'subject_id': self.subject}).json['id']

    def tearDown(self):
        app.DATA = self.original
        self.temp.cleanup()

    def upload(self, files=None, collection=None):
        files = files or [(io.BytesIO(text_pdf()), 'lecture.pdf')]
        return self.client.post(f'/api/practice/collections/{collection or self.collection}/sources',
                                data={'files': files}, content_type='multipart/form-data')

    def source(self):
        self.assertEqual(self.upload().status_code, 200)
        return self.client.get(f'/api/practice/collections/{self.collection}').json['sources'][0]['id']

    def question(self, source_id):
        return dict(question='Explain why TCP is reliable.', model_answer='TCP provides reliable ordered byte-stream delivery.',
                    key_points=['Reliable delivery', 'Ordered byte stream'],
                    citations=[dict(source_id=source_id, page=1, quote='TCP provides reliable ordered delivery')])

    def generate(self, source_id):
        with patch('practice.call_ai', return_value={'questions': [self.question(source_id)]}):
            response = self.client.post(f'/api/practice/collections/{self.collection}/rounds',
                                        json={'count': 1, 'source_ids': [source_id], 'language': 'sr'})
        self.assertEqual(response.status_code, 200, response.json)
        return self.client.get('/api/practice/rounds/' + str(response.json['id'])).json

    def test_multiple_real_pdfs_and_bad_batch_is_atomic(self):
        files = [(io.BytesIO(text_pdf()), 'one.pdf'), (io.BytesIO(text_pdf('UDP sends datagrams without ordering guarantees.')), 'two.pdf')]
        self.assertEqual(self.upload(files).status_code, 200)
        sources = self.client.get(f'/api/practice/collections/{self.collection}').json['sources']
        self.assertEqual(len(sources), 2)
        self.assertEqual(sources[0]['readable_pages'], 1)
        pdf = self.client.get(f"/api/practice/sources/{sources[0]['id']}/pdf")
        self.assertEqual(pdf.mimetype, 'application/pdf')
        self.assertTrue(pdf.data.startswith(b'%PDF-'))
        bad = [(io.BytesIO(text_pdf()), 'valid.pdf'), (io.BytesIO(b'not a pdf'), 'bad.pdf')]
        self.assertEqual(self.upload(bad).status_code, 400)
        self.assertEqual(len(self.client.get(f'/api/practice/collections/{self.collection}').json['sources']), 2)

    def test_blank_pdf_and_upload_limit(self):
        writer = PdfWriter()
        writer.add_blank_page(width=500, height=700)
        content = io.BytesIO()
        writer.write(content)
        content.seek(0)
        response = self.upload([(content, 'scan.pdf')])
        self.assertEqual(response.status_code, 400)
        self.assertIn('OCR', response.json['error'])
        with patch('practice.MAX_PDF_BYTES', 50):
            self.assertEqual(self.upload().status_code, 413)

    def test_missing_key_and_foreign_sources(self):
        source_id = self.source()
        with patch('practice.ai_config', return_value=('', 'gpt-4.1-mini')):
            response = self.client.post(f'/api/practice/collections/{self.collection}/rounds', json={'source_ids': [source_id]})
            self.assertEqual(response.status_code, 503)
        other = self.client.post('/api/practice/collections', json={'name': 'Other', 'subject_id': self.subject}).json['id']
        with patch('practice.call_ai') as ai:
            response = self.client.post(f'/api/practice/collections/{other}/rounds', json={'source_ids': [source_id]})
            self.assertEqual(response.status_code, 400)
            ai.assert_not_called()

    def test_invented_citation_is_rejected_without_saving_round(self):
        source_id = self.source()
        question = self.question(source_id)
        question['citations'][0]['quote'] = 'An invented claim not present in the source.'
        with patch('practice.call_ai', return_value={'questions': [question]}):
            response = self.client.post(f'/api/practice/collections/{self.collection}/rounds', json={'count': 1})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.client.get(f'/api/practice/collections/{self.collection}').json['rounds'], [])

    def test_answer_followup_persistence_and_retry_history(self):
        source_id = self.source()
        generated = self.generate(source_id)
        question_id = generated['questions'][0]['id']
        self.assertNotIn('model_answer', generated['questions'][0])
        evaluation = dict(score=60, correct=['Reliability'], missing=['Ordering'], feedback='Explain ordering too.', followup=self.question(source_id))
        with patch('practice.call_ai', return_value=copy.deepcopy(evaluation)) as ai:
            response = self.client.post(f'/api/practice/questions/{question_id}/answer', json={'answer': 'TCP delivers reliably.'})
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(ai.call_args.args[2]['student_answer'], 'TCP delivers reliably.')
            self.assertEqual(response.json['evaluation']['citations'][0]['name'], 'lecture.pdf')
            attempt_id = response.json['id']
        with patch('practice.call_ai', return_value={**evaluation, 'score': 90, 'followup': None}):
            response = self.client.post(f'/api/practice/attempts/{attempt_id}/followup', json={'answer': 'The byte stream is ordered.'})
            self.assertEqual(response.status_code, 200)
        with patch('practice.call_ai') as ai:
            response = self.client.post(f'/api/practice/attempts/{attempt_id}/followup', json={'answer': 'again'})
            self.assertEqual(response.status_code, 409)
            ai.assert_not_called()
        with patch('practice.call_ai', return_value={**evaluation, 'score': 80, 'followup': None}):
            self.assertEqual(self.client.post(f'/api/practice/questions/{question_id}/answer', json={'answer': 'Reliable and ordered.'}).status_code, 200)
        restored = self.client.get('/api/practice/rounds/' + str(generated['round']['id'])).json
        attempts = restored['questions'][0]['attempts']
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0]['followup_evaluation']['score'], 90)

    def test_invalid_score_and_empty_answer_do_not_create_attempt(self):
        source_id = self.source()
        generated = self.generate(source_id)
        question_id = generated['questions'][0]['id']
        with patch('practice.call_ai') as ai:
            self.assertEqual(self.client.post(f'/api/practice/questions/{question_id}/answer', json={'answer': '  '}).status_code, 400)
            ai.assert_not_called()
        with patch('practice.call_ai', return_value={'score': 150}):
            self.assertEqual(self.client.post(f'/api/practice/questions/{question_id}/answer', json={'answer': 'An answer.'}).status_code, 502)
        self.assertEqual(self.client.get('/api/practice/rounds/' + str(generated['round']['id'])).json['questions'][0]['attempts'], [])

    def test_context_limit_requires_fewer_sources(self):
        self.source()
        with patch('practice.MAX_CONTEXT', 5), patch('practice.call_ai') as ai:
            response = self.client.post(f'/api/practice/collections/{self.collection}/rounds', json={})
            self.assertEqual(response.status_code, 400)
            ai.assert_not_called()

    def test_delete_collection_cascades_and_export_excludes_pdf_bytes(self):
        source_id = self.source()
        generated = self.generate(source_id)
        exported = self.client.get('/api/export').json
        saved = next(source for source in exported['practice_sources'] if source['id'] == source_id)
        self.assertNotIn('content', saved)
        self.assertEqual(self.client.delete(f'/api/practice/collections/{self.collection}', json={}).status_code, 400)
        self.assertEqual(self.client.delete(f'/api/practice/collections/{self.collection}', json={'confirm': True}).status_code, 200)
        self.assertEqual(self.client.get(f'/api/practice/sources/{source_id}/pdf').status_code, 404)
        self.assertEqual(self.client.get('/api/practice/rounds/' + str(generated['round']['id'])).status_code, 404)


if __name__ == '__main__':
    unittest.main()
