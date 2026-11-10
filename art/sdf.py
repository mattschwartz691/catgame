"""Tiny numpy signed-distance toolkit used to sculpt organic meshes procedurally."""
import numpy as np

F = np.float32

def V(*a):
    return np.array(a, dtype=F)

def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25

def smax(a, b, k):
    return -smin(-a, -b, k)

def norm(x):
    return np.sqrt(np.einsum('ij,ij->i', x, x))

def sd_sphere(P, c, r):
    return norm(P - c) - r

def sd_ellipsoid(P, c, r, R=None):
    q = P - c
    if R is not None:
        q = q @ R            # columns of R are the local axes
    k0 = norm(q / r)
    k1 = norm(q / (r * r))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

def sd_roundcone(P, a, b, r1, r2):
    """Capsule whose radius goes r1->r2. Returns (distance, t along the axis)."""
    ba = b - a
    t = np.clip(((P - a) @ ba) / float(ba @ ba), 0.0, 1.0)
    d = norm(P - (a + t[:, None] * ba)) - (r1 + (r2 - r1) * t)
    return d, t

def _tri_iso(px, py, w, h):
    """2D isosceles triangle, tip at origin, base (half width w) at y = h."""
    px = np.abs(px)
    qq = w * w + h * h
    s = np.clip((px * w + py * h) / qq, 0.0, 1.0)
    ax, ay = px - w * s, py - h * s
    s2 = np.clip(px / w, 0.0, 1.0)
    bx, by = px - w * s2, py - h
    d1 = ax * ax + ay * ay
    d2 = bx * bx + by * by
    sg = -np.sign(h)
    c1 = sg * (px * h - py * w)
    c2 = sg * (py - h)
    dd = np.minimum(d1, d2)
    cc = np.minimum(c1, c2)
    return -np.sqrt(dd) * np.sign(cc)

def sd_ear(P, tip, base, facing, w, thick, rnd, cup=0.0, tip_round=0.0):
    """Rounded triangular plate from `base` (centre of the bottom edge) up to `tip`."""
    yd = base - tip
    h = float(np.linalg.norm(yd)); yd = yd / h
    z = facing - yd * float(facing @ yd); z = z / np.linalg.norm(z)
    x = np.cross(yd, z)
    q = P - tip
    lx, ly, lz = q @ x, q @ yd, q @ z
    lz = lz - cup * (lx / w) ** 2 * w
    d2 = _tri_iso(lx, ly + tip_round, w, h + tip_round)
    wy = np.abs(lz) - thick * 0.5
    d = np.minimum(np.maximum(d2, wy), 0.0) + np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(wy, 0) ** 2)
    return d - rnd, (lx, ly, lz)

def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=F)

def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=F)

def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=F)


# ---------------------------------------------------------------- noise
def _hash3(ix, iy, iz, seed=0):
    n = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + iz.astype(np.int64) * 2147483647 + seed * 144665) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    n = n ^ (n >> 16)
    return (n & 0xFFFFFF).astype(F) / F(0xFFFFFF)

def vnoise(P, freq, seed=0):
    """Trilinear value noise in [0,1]."""
    q = P * freq
    i = np.floor(q).astype(np.int64)
    f = (q - i).astype(F)
    f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out = out + w * _hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out

def fbm(P, freq, octaves=4, seed=0):
    out, amp, tot = 0, 1.0, 0.0
    for o in range(octaves):
        out = out + amp * vnoise(P, freq * (2 ** o), seed + o * 17)
        tot += amp; amp *= 0.5
    return out / tot

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)
