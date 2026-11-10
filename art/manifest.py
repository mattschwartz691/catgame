"""Totals the game shows before every house has loaded.  Run:  python3 art/manifest.py"""
import json, os
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
n = sum(len(json.load(open(os.path.join(A, f)))['treats']) for f in ('house/house.json', 'house2/house.json', 'street/street.json') if os.path.exists(os.path.join(A, f)))
json.dump(dict(treats=n), open(os.path.join(A, 'manifest.json'), 'w'))
print('manifest: %d treats' % n)
