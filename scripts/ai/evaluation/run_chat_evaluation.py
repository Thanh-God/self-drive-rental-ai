"""chat-v1 live evaluation around AiChatEvaluationIT.

  prepare  validate a split, resolve {D+n}/{ISO+n} for today's Vietnam date and write cases.json
  score    score the IT's observations.json with chat_scoring and write summary.json and report.md

The live step in between asks every turn exactly once:
  KDRIVE_EVAL_LIVE=1 mvnw -Dtest=AiChatEvaluationIT -Dai.chat.cases=<cases.json> -Dai.chat.output=<observations.json> test
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chat_scoring as cs

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
VN = timezone(timedelta(hours=7))


def vietnam_today(now=None):
    return (now or datetime.now(timezone.utc)).astimezone(VN).date()


def prepare(split, out_dir, today, heldout_sha=None, kb=None, dataset='chat-v1'):
    kb = kb or cs.load_knowledge()
    path = HERE / dataset / f'{split}.json'
    if split == 'heldout':
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if heldout_sha is None or actual != heldout_sha:
            raise cs.DatasetError('heldout hash missing or changed; heldout must stay frozen')
    doc = cs.load_split(path, kb)
    resolved = {**doc, 'resolvedFor': today.isoformat(), 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'cases': [cs.resolve(c, today) for c in doc['cases']]}
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=False)
    (out / 'cases.json').write_text(json.dumps(resolved, ensure_ascii=False, indent=2), encoding='utf-8')
    return resolved


def score(cases_doc, observations, kb=None):
    kb = kb or cs.load_knowledge()
    asked = {o['id']: o['turns'] for o in observations.get('cases', [])}
    today = datetime.fromisoformat(cases_doc['resolvedFor']).date()
    facts = cs.load_facts()
    results = [cs.score_case(c, asked.get(c['id'], []), kb, today, facts) for c in cases_doc['cases']]
    summary = cs.summarize(results)
    warm = observations.get('warmup') or {}
    summary.update(dataset=cases_doc.get('version'), split=cases_doc['split'], model=observations.get('model'), resolvedFor=cases_doc['resolvedFor'],
                   coldMs=warm.get('elapsedMs'), coldStatus=warm.get('status'),
                   notAsked=sorted(c['id'] for c in cases_doc['cases'] if c['id'] not in asked))
    return results, summary


def report(results, summary):
    o = summary['outcomes']
    lines = [f"# {summary.get('dataset', 'chat')} {summary['split']} — {summary['model']} ({summary['resolvedFor']})", '',
             f"Ca: {summary['cases']} · PASS {o['PASS']} · SAFE_MISS {o['SAFE_MISS']} · FAIL {o['FAIL']} · UNSAFE {o['UNSAFE']} · ERROR {o['ERROR']}",
             f"Thời gian/lượt: p50 {summary['latencyMs']['p50']} ms · p95 {summary['latencyMs']['p95']} ms · {summary['latencyMs']['turns']} lượt · lượt khởi động (cold) {summary['coldMs']} ms",
             '', '| Nhóm | PASS | SAFE_MISS | FAIL | UNSAFE | ERROR |', '|---|---|---|---|---|---|']
    for cat, counts in summary['byCategory'].items():
        lines.append(f"| {cat} | " + ' | '.join(str(counts.get(k, 0)) for k in cs.OUTCOMES) + ' |')
    lines += ['', '## Ca không đạt', '']
    for r in results:
        if r['outcome'] != 'PASS':
            detail = '; '.join(f"lượt {i}: {v} — {d}" for i, v, d in r['checks'] if v != 'PASS')
            lines.append(f"- `{r['id']}` ({r['category']}) **{r['outcome']}**: {detail}")
    return '\n'.join(lines) + '\n'


def main(argv=None):
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='command', required=True)
    pr = sub.add_parser('prepare')
    pr.add_argument('--split', choices=['dev', 'heldout'], required=True)
    pr.add_argument('--out', required=True)
    pr.add_argument('--heldout-sha')
    pr.add_argument('--dataset', choices=['chat-v1', 'chat-v2'], default='chat-v2')
    sc = sub.add_parser('score')
    sc.add_argument('--dir', required=True)
    a = p.parse_args(argv)
    if a.command == 'prepare':
        out = Path(a.out).resolve()
        assert out.is_relative_to(REPO / '.runtime'), 'runtime output only'
        doc = prepare(a.split, out, vietnam_today(), a.heldout_sha, dataset=a.dataset)
        print(f"prepared {len(doc['cases'])} {a.split} cases for {doc['resolvedFor']}")
        return 0
    d = Path(a.dir).resolve()
    cases_doc = json.loads((d / 'cases.json').read_text(encoding='utf-8'))
    observations = json.loads((d / 'observations.json').read_text(encoding='utf-8'))
    results, summary = score(cases_doc, observations)
    (d / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    (d / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    (d / 'report.md').write_text(report(results, summary), encoding='utf-8')
    print(json.dumps(summary['outcomes']), summary['latencyMs'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
