"""The cat, described as smoothly blended signed-distance primitives in its rest (standing) pose.
Units are 'cat units' (the game scales the cat by 1.25). +Z is forward, +Y up, +X the cat's left."""
import numpy as np
from sdf import *

BONES = ['hips', 'chest', 'head', 'jaw', 'earL', 'earR'] + ['tail%d' % i for i in range(9)] + \
    ['FLu', 'FLl', 'FLp', 'FRu', 'FRl', 'FRp', 'HLt', 'HLs', 'HLm', 'HLp', 'HRt', 'HRs', 'HRm', 'HRp']
BI = {n: i for i, n in enumerate(BONES)}

# rest joints (left side; mirror x for right)
J = dict(
    sh=V(.06, .25, .15), el=V(.061, .1457, .0907), wrist=V(.062, .058, .147), fpaw=V(.062, .03, .15),
    hip=V(.064, .25, -.15), knee=V(.0676, .1576, -.0735), hock=V(.068, .102, -.191), hpaw=V(.068, .03, -.165),
    head=V(0, .385, .27), jaw=V(0, .352, .30), ear=V(.058, .452, .268), eye=V(.0455, .403, .335),
    tail=V(0, .305, -.232), body=V(0, .28, 0), chest=V(0, .28, .02), hipsP=V(0, .28, -.02),
)
HEAD_S = 1.13
HEAD_PIVOT = V(0, .375, .25)
def hs(v):
    return HEAD_PIVOT + (v - HEAD_PIVOT) * HEAD_S
for _k in ('head', 'jaw', 'ear', 'eye'):
    J[_k] = hs(J[_k])
EYE_R = 0.0255 * HEAD_S
TAIL_N, TAIL_SEG = 10, 0.046

def tail_points():
    pts = [J['tail'].copy()]
    for i in range(1, TAIL_N):
        e = 0.42 + 0.045 * i
        pts.append(pts[-1] + V(0, np.sin(e), -np.cos(e)) * TAIL_SEG)
    return pts

def mx(v):
    return V(-v[0], v[1], v[2])


class Prim:
    def __init__(self, name, fn, k, bones, part, neg=False):
        self.name, self.fn, self.k, self.bones, self.part, self.neg = name, fn, k, bones, part, neg


class Model:
    def __init__(self):
        self.prims = []
        self.scale = None

    def add(self, name, fn, k, bones, part, neg=False):
        if self.scale is not None:           # uniform scale of a primitive about a pivot
            piv, sc, f0 = self.scale[0], self.scale[1], fn
            def fn(P, f0=f0, piv=piv, sc=sc):
                r = f0((P - piv) / sc + piv)
                return (r[0] * sc, r[1]) if isinstance(r, tuple) else r * sc
            k = k * sc
        self.prims.append(Prim(name, fn, k, bones, part, neg))

    def _eval(self, P, full):
        d = np.full(len(P), 1e3, dtype=F)
        D, T = [], []
        for p in self.prims:
            r = p.fn(P)
            di, ti = (r if isinstance(r, tuple) else (r, None))
            di = di.astype(F)
            if p.neg:
                d = smax(d, -di, p.k)
            else:
                d = smin(d, di, p.k)
            if full:
                D.append(di); T.append(ti)
        return (d, D, T) if full else d

    def sdf(self, P, chunk=400000):
        out = np.empty(len(P), dtype=F)
        for s in range(0, len(P), chunk):
            out[s:s + chunk] = self._eval(P[s:s + chunk], False)
        return out

    def grad(self, P, e=0.0012):
        g = np.empty_like(P)
        for a in range(3):
            o = np.zeros(3, dtype=F); o[a] = e
            g[:, a] = (self.sdf(P + o) - self.sdf(P - o)) / (2 * e)
        return g

    def analyse(self, P, soft=0.011, chunk=200000):
        """Per point: bone weights (N, nBones) and a dict part -> min distance to that part's primitives."""
        W = np.zeros((len(P), len(BONES)), dtype=F)
        parts = {}
        for s in range(0, len(P), chunk):
            Q = P[s:s + chunk]
            _, D, T = self._eval(Q, True)
            pos = [i for i, p in enumerate(self.prims) if not p.neg]
            dmin = np.min(np.stack([D[i] for i in pos]), axis=0)
            for i, p in enumerate(self.prims):
                part = parts.setdefault(p.part, np.full(len(P), 1e3, dtype=F))
                part[s:s + chunk] = np.minimum(part[s:s + chunk], D[i])
                if p.neg:
                    continue
                w = np.exp(-np.maximum(D[i] - dmin, 0) / soft)
                b = p.bones(Q, T[i]) if callable(p.bones) else p.bones
                for name, bw in b.items():
                    W[s:s + chunk, BI[name]] += w * bw
        return W, parts


def build():
    m = Model()
    S = lambda c, r: (lambda P: sd_sphere(P, c, r))
    E = lambda c, r, R=None: (lambda P: sd_ellipsoid(P, c, V(*r), R))
    RC = lambda a, b, r1, r2: (lambda P: sd_roundcone(P, a, b, r1, r2))

    # ---- torso: weights slide from hips to chest along z
    def spine(P, t):
        w = sstep(-0.1, 0.1, P[:, 2])
        return {'chest': w, 'hips': 1 - w}
    m.add('chest', E(V(0, .272, .112), (.08, .097, .118)), 0, spine, 'torso')
    m.add('belly', E(V(0, .285, -.01), (.074, .079, .15)), .05, spine, 'torso')
    m.add('rump', E(V(0, .282, -.13), (.082, .088, .1)), .05, spine, 'torso')
    m.add('chestfluff', E(V(0, .25, .198), (.05, .062, .045)), .04, {'chest': 1}, 'bib')
    m.add('neck', RC(V(0, .30, .175), V(0, .372, .25), .066, .06), .04,
          lambda P, t: {'chest': 1 - sstep(.15, .85, t), 'head': sstep(.15, .85, t)}, 'neck')

    # ---- head (authored at 1:1, then scaled up about the neck for a cuter silhouette)
    m.scale = (HEAD_PIVOT, HEAD_S)
    J0 = dict(eye=V(.0455, .403, .335))
    m.add('skull', E(V(0, .394, .28), (.097, .085, .09)), .03, {'head': 1}, 'head')
    m.add('forehead', E(V(0, .412, .315), (.07, .05, .05)), .03, {'head': 1}, 'head')
    for sx, sfx in ((1, 'L'), (-1, 'R')):
        X = (lambda v: v) if sx > 0 else mx
        m.add('cheek' + sfx, S(X(V(.056, .362, .305)), .046), .03, {'head': 1}, 'cheek')
        m.add('tuft' + sfx, RC(X(V(.07, .358, .295)), X(V(.108, .338, .268)), .03, .006), .02, {'head': 1}, 'cheek')
        m.add('pad' + sfx, E(X(V(.0195, .354, .362)), (.03, .026, .027)), .018, {'head': 1}, 'muzzle')
        m.add('brow' + sfx, RC(X(V(.022, .428, .345)), X(V(.07, .422, .318)), .02, .016), .025, {'head': 1}, 'head')
    m.add('bridge', RC(V(0, .398, .345), V(0, .374, .382), .03, .017), .025, {'head': 1}, 'bridge')
    m.add('nose', E(V(0, .3725, .391), (.0135, .0095, .0095)), .005, {'head': 1}, 'nose')
    m.add('chin', RC(V(0, .334, .345), V(0, .34, .30), .0215, .03), .014, {'jaw': 1}, 'chin')
    for sx, sfx in ((1, 'L'), (-1, 'R')):
        X = (lambda v: v) if sx > 0 else mx
        m.add('socket' + sfx, S(X(J0['eye'] + V(0, 0, .002)), .0245), .012, None, 'socket', neg=True)
        # ears: plate + carved inner dish
        tip, base = X(V(.09, .536, .264)), X(V(.06, .45, .272))
        facing = X(V(.55, .1, .83))
        def ear(P, tip=tip, base=base, facing=facing):
            d, _ = sd_ear(P, tip, base, facing, .045, .015, .006, cup=.3, tip_round=.014)
            return d
        m.add('ear' + sfx, ear, .024, {'ear' + sfx: 1}, 'ear')
        f = facing / np.linalg.norm(facing)
        def dish(P, tip=tip, base=base, facing=facing, f=f):
            t2 = tip + (base - tip) * .2 + f * .014
            b2 = base + (tip - base) * .1 + f * .016
            d, _ = sd_ear(P, t2, b2, facing, .031, .012, .003, cup=.3, tip_round=.01)
            return d
        m.add('dish' + sfx, dish, .006, None, 'earin', neg=True)

    m.scale = None
    # ---- legs
    for sx, sfx in ((1, 'L'), (-1, 'R')):
        X = (lambda v: v) if sx > 0 else mx
        sh, el, wr, fp = X(J['sh']), X(J['el']), X(J['wrist']), X(J['fpaw'])
        hip, kn, hk, hp = X(J['hip']), X(J['knee']), X(J['hock']), X(J['hpaw'])
        m.add('shoulder' + sfx, E(sh + V(0, .012, -.005), (.04, .07, .058)), .035, {'chest': .6, 'F%su' % sfx: .4}, 'torso')
        m.add('uarm' + sfx, RC(sh, el, .041, .031), .03, {'F%su' % sfx: 1}, 'legfu')
        m.add('farm' + sfx, RC(el, wr, .03, .0225), .02, {'F%sl' % sfx: 1}, 'legfl')
        m.add('fpaw' + sfx, E(fp + V(0, -.004, .014), (.031, .0245, .041)), .018, {'F%sp' % sfx: 1}, 'pawf')
        m.add('haunch' + sfx, E(hip + V(-.004 * sx, -.02, .02), (.042, .078, .072), rot_x(-.35)), .04, {'hips': .55, 'H%st' % sfx: .45}, 'torso')
        m.add('thigh' + sfx, RC(hip, kn, .056, .04), .035, {'H%st' % sfx: 1}, 'leght')
        m.add('shin' + sfx, RC(kn, hk, .036, .021), .022, {'H%ss' % sfx: 1}, 'leghs')
        m.add('meta' + sfx, RC(hk, hp + V(0, .018, -.004), .021, .02), .012, {'H%sm' % sfx: 1}, 'leghm')
        m.add('hpaw' + sfx, E(hp + V(0, -.004, .014), (.031, .0245, .041)), .018, {'H%sp' % sfx: 1}, 'pawh')
        for (c, bone, part) in ((fp, 'F%sp' % sfx, 'pawf'), (hp, 'H%sp' % sfx, 'pawh')):
            for dx, dz in ((-.02, .04), (-.007, .047), (.007, .047), (.02, .04)):
                m.add('toe', S(c + V(dx, -.011, dz), .0125), .006, {bone: 1}, part)

    # ---- tail
    tp = tail_points()
    for i in range(TAIL_N - 1):
        r1 = .0275 - .0065 * (i / (TAIL_N - 1)); r2 = .0275 - .0065 * ((i + 1) / (TAIL_N - 1))
        m.add('tail%d' % i, RC(tp[i], tp[i + 1], r1, r2), 0 if i else .03, {'tail%d' % i: 1}, 'tail')
    return m
