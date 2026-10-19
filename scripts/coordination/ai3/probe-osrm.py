"""Read-only local OSRM graph smoke test; does not start or stop services."""
import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request

REPO = Path(__file__).resolve().parents[3]


def query(coordinates):
    url = ('http://127.0.0.1:5000/route/v1/driving/' + coordinates
           + '?overview=false&steps=false&alternatives=false&radiuses=1000;1000')
    try:
        response = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(32769)
        assert len(data) <= 32768, 'Oversized response'
        return response.status, json.loads(data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()
    output = Path(args.evidence).resolve()
    assert output.is_relative_to(REPO / '.runtime') and not output.exists(), 'New runtime evidence required'
    output.mkdir(parents=True)
    report = {'status': 'FAIL', 'scope': 'raw OSRM graph; not backend API or browser acceptance'}
    try:
        status, route = query('108.2022,16.0544;108.338,15.8801')
        assert status == 200 and route.get('code') == 'Ok', 'Da Nang–Hoi An route missing'
        routes = route.get('routes')
        assert isinstance(routes, list) and len(routes) == 1
        facts = routes[0]
        assert isinstance(facts.get('distance'), (int, float)) and 10000 < facts['distance'] < 100000
        assert isinstance(facts.get('duration'), (int, float)) and 300 < facts['duration'] < 20000
        report['driving'] = {'distanceMeters': facts['distance'], 'durationSeconds': facts['duration']}
        status, missing = query('0,0;108.338,15.8801')
        assert status in (200, 400) and missing.get('code') in ('NoSegment', 'NoRoute')
        assert not missing.get('routes'), 'No-route must not provide fabricated estimates'
        report['outsideCoverage'] = missing['code']
        report['status'] = 'PASS scoped'
    finally:
        (output / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
