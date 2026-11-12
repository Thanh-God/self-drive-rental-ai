"""Tests for the per-stage latency summary. Synthetic reports only; no model is called."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chat_timing_summary as ts


def timing(intent='ANSWER', status=200, model=True, direct=False, total=5000, model_ms=4500, load=50, search=None):
    usage = None if not model else {'totalMs': model_ms - 100, 'loadMs': load, 'promptTokens': 1800, 'promptMs': 2000,
                                    'outputTokens': 60, 'outputMs': 2300}
    return {'intent': intent if status == 200 else None, 'status': status, 'modelCalled': model,
            'answeredWithoutModel': direct, 'retrieveMs': 2, 'branchesMs': 1, 'branchReads': 1,
            'modelMs': model_ms if model else None, 'usage': usage, 'searchMs': search, 'totalMs': total}


def report(*timings, untimed=0):
    turns = [{'status': 200, 'timing': t} for t in timings] + [{'status': 'TIMEOUT'}] * untimed
    return {'model': 'qwen3:8b', 'split': 'dev', 'warmup': {'timing': timing(total=99999)}, 'cases': [{'id': 'c', 'turns': turns}]}


class TimingSummaryTests(unittest.TestCase):
    def test_turns_are_grouped_by_what_the_backend_did(self):
        s = ts.summarize(report(timing(), timing('OUT_OF_SCOPE'), timing('ASK_MISSING', search=40),
                                timing('SEARCH_VEHICLES', direct=True, model=False, total=300, search=250),
                                timing('OUT_OF_SCOPE', model=False, total=5), timing(status=503, total=60000)))
        self.assertEqual({'FAQ': 2, 'SEARCH': 1, 'DIRECT': 1, 'NO_MODEL': 1, 'ERROR': 1},
                         {k: g['turns'] for k, g in s['groups'].items()})
        self.assertEqual(6, s['turnsWithTiming'])

    def test_the_warmup_and_untimed_turns_are_left_out(self):
        s = ts.summarize(report(timing(total=4000), untimed=2))
        self.assertEqual(1, s['turnsWithTiming'])
        self.assertEqual(2, s['turnsWithoutTiming'])
        self.assertEqual(4000, s['groups']['FAQ']['stages']['totalMs']['max'], 'the 99999 ms warm-up is not counted')

    def test_cold_calls_are_counted_and_excluded_from_the_target(self):
        s = ts.summarize(report(timing(total=40000, load=8000), *[timing(total=6000 + i) for i in range(19)]))
        faq = s['groups']['FAQ']
        self.assertEqual(1, faq['cold'])
        self.assertEqual(19, faq['warmTotalMs']['n'])
        self.assertEqual(40000, faq['stages']['totalMs']['max'], 'all turns stay in the stage figures')
        self.assertTrue(faq['target']['met'])
        self.assertFalse(faq['target']['enoughSamples'], '19 warm turns are fewer than the minimum')

    def test_a_slow_search_misses_its_target_and_percentiles_are_nearest_rank(self):
        s = ts.summarize(report(*[timing('ASK_MISSING', total=t, search=30) for t in (10000, 20000, 31000, 35000)]))
        target = s['groups']['SEARCH']['target']
        self.assertEqual(35000, target['warmP95Ms'])
        self.assertFalse(target['met'])
        self.assertEqual(20000, s['groups']['SEARCH']['stages']['totalMs']['p50'])
        self.assertEqual({'n': 4, 'p50': 1800, 'p95': 1800, 'max': 1800}, s['groups']['SEARCH']['ollama']['promptTokens'])

    def test_missing_figures_are_skipped_not_zeroed(self):
        t = timing()
        t['usage'] = {'totalMs': None, 'loadMs': None, 'promptTokens': None, 'promptMs': None, 'outputTokens': None, 'outputMs': None}
        s = ts.summarize(report(t))
        self.assertEqual({'n': 0, 'p50': None, 'p95': None, 'max': None}, s['groups']['FAQ']['ollama']['promptMs'])
        self.assertEqual(0, s['groups']['FAQ']['cold'])

    def test_cli_never_overwrites_an_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp) / 'r.json', Path(tmp) / 's.json'
            src.write_text(json.dumps(report(timing())), encoding='utf-8')
            ts.main([str(src), '--out', str(out)])
            self.assertIn('FAQ', json.loads(out.read_text(encoding='utf-8'))['groups'])
            with self.assertRaises(SystemExit):
                ts.main([str(src), '--out', str(out)])


if __name__ == '__main__':
    unittest.main()
