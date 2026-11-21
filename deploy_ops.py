# usage: python3 deploy_ops.py OLD.json NEW.json  -> prints update_workflow operations (JSON) to stdout
import json, sys
old = json.load(open(sys.argv[1])); new = json.load(open(sys.argv[2]))
on = {n['name']: n for n in old['nodes']}; nn = {n['name']: n for n in new['nodes']}
ops = []
SET_KEYS = ['alwaysOutputData', 'executeOnce', 'onError', 'retryOnFail', 'maxTries', 'waitBetweenTries']
for name in on:
    if name not in nn: ops.append({'type': 'removeNode', 'nodeName': name})
for name, n in nn.items():
    if name not in on:
        node = {k: n[k] for k in ['name', 'type', 'typeVersion', 'position', 'parameters'] if k in n}
        if n.get('credentials'): node['credentials'] = n['credentials']
        ops.append({'type': 'addNode', 'node': node})
        st = {k: n[k] for k in SET_KEYS if k in n}
        if st: ops.append({'type': 'setNodeSettings', 'nodeName': name, 'settings': st})
    else:
        o = on[name]
        if json.dumps(o['parameters'], sort_keys=True) != json.dumps(n['parameters'], sort_keys=True):
            ops.append({'type': 'updateNodeParameters', 'nodeName': name, 'parameters': n['parameters'], 'replace': True})
        st = {k: n[k] for k in SET_KEYS if k in n and o.get(k) != n[k]}
        if st: ops.append({'type': 'setNodeSettings', 'nodeName': name, 'settings': st})
def edges(wf):
    e = set()
    for src, c in wf['connections'].items():
        for typ, outs in c.items():
            for i, lst in enumerate(outs):
                for t in lst or []: e.add((src, i, t['node'], t.get('index', 0), typ))
    return e
eo, en = edges(old), edges(new)
removed_nodes = {o['nodeName'] for o in ops if o['type'] == 'removeNode'}
for (s, i, t, ti, typ) in sorted(eo - en):
    if s in removed_nodes or t in removed_nodes: continue
    ops.append({'type': 'removeConnection', 'source': s, 'sourceIndex': i, 'target': t, 'targetIndex': ti, 'connectionType': typ})
for (s, i, t, ti, typ) in sorted(en - eo):
    ops.append({'type': 'addConnection', 'source': s, 'sourceIndex': i, 'target': t, 'targetIndex': ti, 'connectionType': typ})
json.dump(ops, sys.stdout)
