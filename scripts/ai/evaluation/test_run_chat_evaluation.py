"""Tests for the chat-v1 live evaluation wrapper (prepare/score/report). No model is called."""
import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chat_scoring as cs
import run_chat_evaluation as run

KB = cs.load_knowledge()
HELD = Path(__file__).resolve().parent / 'chat-v1' / 'heldout.json'


class RunChatEvaluationTests(unittest.TestCase):
    def test_vietnam_today_crosses_utc_midnight(self):
        self.assertEqual(date(2026, 11, 12), run.vietnam_today(datetime(2026, 11, 11, 17, 0, tzinfo=timezone.utc)))
        self.assertEqual(date(2026, 11, 11), run.vietnam_today(datetime(2026, 11, 11, 16, 59, tzinfo=timezone.utc)))

    def test_prepare_resolves_dates_and_keeps_heldout_frozen(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = run.prepare('dev', Path(tmp) / 'dev', date(2026, 11, 11), kb=KB)
            text = json.dumps(doc, ensure_ascii=False)
            self.assertNotIn('{D+', text)
            self.assertNotIn('{ISO+', text)
            self.assertEqual('2026-11-11', doc['resolvedFor'])
            self.assertTrue((Path(tmp) / 'dev' / 'cases.json').is_file())
            with self.assertRaises(cs.DatasetError):
                run.prepare('heldout', Path(tmp) / 'h1', date(2026, 11, 11), heldout_sha=None, kb=KB)
            with self.assertRaises(cs.DatasetError):
                run.prepare('heldout', Path(tmp) / 'h2', date(2026, 11, 11), heldout_sha='0' * 64, kb=KB)
            sha = hashlib.sha256(HELD.read_bytes()).hexdigest()
            self.assertEqual(32, len(run.prepare('heldout', Path(tmp) / 'h3', date(2026, 11, 11), sha, KB)['cases']))
            with self.assertRaises(FileExistsError):
                run.prepare('dev', Path(tmp) / 'dev', date(2026, 11, 11), kb=KB)

    def test_score_counts_unasked_cases_as_failures_and_reports_cold_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            cases = run.prepare('dev', Path(tmp) / 'd', date(2026, 11, 11), kb=KB)
        pii = next(c for c in cases['cases'] if c['category'] == 'pii')
        knowledge = next(c for c in cases['cases'] if c['category'] == 'knowledge')
        kid = knowledge['turns'][0]['expect']['anyOf'][0]['citationsAny'][0]
        observations = {'model': 'qwen3:8b', 'warmup': {'status': 200, 'elapsedMs': 30000}, 'cases': [
            {'id': pii['id'], 'turns': [{'status': 400, 'body': {'message': 'x'}, 'elapsedMs': 50}]},
            {'id': knowledge['id'], 'turns': [{'status': 200, 'elapsedMs': 9000, 'body': {
                'intent': 'ANSWER', 'reply': 'Đúng theo mục.', 'citations': [{'id': kid, 'title': 't'}],
                'criteria': None, 'missing': [], 'cards': []}}]}]}
        results, summary = run.score(cases, observations, KB)
        by_id = {r['id']: r['outcome'] for r in results}
        self.assertEqual('PASS', by_id[pii['id']])
        self.assertEqual('PASS', by_id[knowledge['id']])
        self.assertEqual(32 - 2, summary['outcomes']['FAIL'], 'a case never asked is a failure, not a skip')
        self.assertEqual(30, len(summary['notAsked']))
        self.assertEqual((30000, 200), (summary['coldMs'], summary['coldStatus']))
        md = run.report(results, summary)
        self.assertIn('PASS 2', md)
        self.assertIn('| knowledge |', md)
        self.assertIn('lượt khởi động (cold) 30000 ms', md)
        self.assertNotIn(f"`{pii['id']}`", md, 'passing cases are not listed as failures')


if __name__ == '__main__':
    unittest.main()
