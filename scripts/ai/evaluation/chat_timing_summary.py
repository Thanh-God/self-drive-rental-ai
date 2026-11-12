"""Per-stage latency summary of a live chat run (R7, REVIEW #17).

Reads the report written by AiChatEvaluationIT (each turn carries the backend's `timing` record: durations and
counts only) and groups turns by what the backend did: a knowledge answer from the model (FAQ), a vehicle-search
turn from the model (SEARCH), a search turn answered without the model (DIRECT), other answers without the model,
and errors. A model call whose Ollama load took at least COLD_LOAD_MS counts as cold (the model was being loaded).
The warm-up question is left out. Targets are the D6 proposal and are reported, never enforced here.

Usage: python chat_timing_summary.py <report.json> [--out summary.json]
"""
import argparse
import json
import sys
from pathlib import Path

from chat_scoring import percentile

COLD_LOAD_MS = 1000
TARGETS_P95_MS = {'FAQ': 15000, 'SEARCH': 30000}
MIN_SAMPLES = 20
STAGES = ('totalMs', 'retrieveMs', 'branchesMs', 'modelMs', 'searchMs')
USAGE = ('totalMs', 'loadMs', 'promptTokens', 'promptMs', 'outputTokens', 'outputMs')


def kind(t):
    if t.get('status') != 200 or t.get('intent') is None:
        return 'ERROR'
    if t.get('answeredWithoutModel'):
        return 'DIRECT'
    if not t.get('modelCalled'):
        return 'NO_MODEL'
    return 'SEARCH' if t['intent'] in ('ASK_MISSING', 'SEARCH_VEHICLES') else 'FAQ'


def cold(t):
    load = (t.get('usage') or {}).get('loadMs')
    return load is not None and load >= COLD_LOAD_MS


def spread(values):
    values = [v for v in values if v is not None]
    return {'n': len(values), 'p50': percentile(values, 50), 'p95': percentile(values, 95),
            'max': max(values) if values else None}


def summarize(report):
    turns = [turn['timing'] for case in report.get('cases', []) for turn in case.get('turns', []) if turn.get('timing')]
    missing = sum(1 for case in report.get('cases', []) for turn in case.get('turns', []) if not turn.get('timing'))
    groups = {}
    for t in turns:
        groups.setdefault(kind(t), []).append(t)
    out = {'model': report.get('model'), 'split': report.get('split'), 'turnsWithTiming': len(turns),
           'turnsWithoutTiming': missing, 'coldLoadMs': COLD_LOAD_MS, 'groups': {}}
    for name in sorted(groups):
        ts = groups[name]
        g = {'turns': len(ts), 'cold': sum(1 for t in ts if cold(t))}
        g['stages'] = {s: spread([t.get(s) for t in ts]) for s in STAGES}
        g['ollama'] = {u: spread([(t.get('usage') or {}).get(u) for t in ts]) for u in USAGE}
        g['branchReads'] = sorted({t.get('branchReads') for t in ts})
        warm = [t['totalMs'] for t in ts if not cold(t)]
        g['warmTotalMs'] = spread(warm)
        if name in TARGETS_P95_MS:
            p95 = percentile(warm, 95)
            g['target'] = {'p95Ms': TARGETS_P95_MS[name], 'warmP95Ms': p95,
                           'met': None if p95 is None else p95 <= TARGETS_P95_MS[name],
                           'enoughSamples': len(warm) >= MIN_SAMPLES}
        out['groups'][name] = g
    return out


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('report')
    p.add_argument('--out')
    a = p.parse_args(argv)
    summary = summarize(json.loads(Path(a.report).read_text(encoding='utf-8')))
    text = json.dumps(summary, ensure_ascii=False, indent=2)
    if a.out:
        out = Path(a.out)
        if out.exists():
            sys.exit('output exists: ' + str(out))
        out.write_text(text + '\n', encoding='utf-8')
    print(text)


if __name__ == '__main__':
    main()
