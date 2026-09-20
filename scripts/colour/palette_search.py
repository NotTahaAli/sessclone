"""Shared palette-search machinery: constants, candidate generation and the
CIEDE2000 max-min search.  Imported by measure.py (the published-palette
measurement) and band.py (the lightness-banded re-run).  Stdlib only.
"""
import itertools
import json
import os
import math
import random
import sys
import time

from colorlib import (VISIONS, ciede2000, composite_over, contrast_ratio,
                      hex_to_lab, lab_all_visions, lab_to_lch,
                      lch_to_hex_if_in_gamut, simulate_hex)

QUICK = '--quick' in sys.argv
random.seed(20260920)
# SEED env var varies the search's random restarts between runs; every run's
# winner is merged into best_known.json, so more runs can only improve the
# published numbers. SEED=0 is the default and is fully reproducible.
SEED_SALT = int(os.environ.get('SEED', '0'))

# ---------------------------------------------------------------- inputs

THEMES = {
    'light': {'ground': '#FAF9F5', 'surface': '#FFFFFF'},
    'dark':  {'ground': '#1A1918', 'surface': '#262624'},
}

PUBLISHED = {
    'light': [('s1', '#128DC1'), ('s2', '#005E43'), ('s3', '#5A5400'),
              ('s4', '#E96C17'), ('s5', '#A24D7F'), ('other', '#87867F')],
    'dark':  [('s1', '#61C3FA'), ('s2', '#007A58'), ('s3', '#D6CA27'),
              ('s4', '#D86003'), ('s5', '#CE73A7'), ('other', '#B0AEA5')],
}

# Okabe & Ito's colour-universal-design categorical set.  Hex values as
# published by Okabe & Ito, "Color Universal Design (CUD): How to make figures
# and presentations that are friendly to colorblind people" (J*Fly,
# https://jfly.uni-koeln.de/color/ ).  Hue angles are COMPUTED from these hexes
# below, not quoted.
OKABE_ITO = {
    'orange':         '#E69F00',
    'sky blue':       '#56B4E9',
    'bluish green':   '#009E73',
    'yellow':         '#F0E442',
    'blue':           '#0072B2',
    'vermillion':     '#D55E00',
    'reddish purple': '#CC79A7',
}

MIN_CONTRAST = 3.0          # WCAG 2.2 SC 1.4.11 non-text contrast
HUE_TOL = 2.0               # deg; 8-bit quantisation moves h* a little
MIN_CHROMA_SERIES = 10.0    # below this a "hue" is not a hue any more
MAX_CHROMA_NEUTRAL = 8.0    # the task's definition of neutral

COARSE = (3.0, 6.0) if not QUICK else (4.0, 8.0)
FINE = (0.5, 1.0)
RESTARTS = 4 if not QUICK else 2
KICKS = 30 if not QUICK else 5

OKABE_HUE = {name: lab_to_lch(hex_to_lab(h))[2] for name, h in OKABE_ITO.items()}

# ---------------------------------------------------------------- helpers


def lch(h):
    return lab_to_lch(hex_to_lab(h))


def labs4(h):
    d = lab_all_visions(h)
    return tuple(d[v] for v in VISIONS)


def pair_min(labsA, labsB):
    """min CIEDE2000 between two colours over the four vision types."""
    return min(ciede2000(labsA[i], labsB[i]) for i in range(4))


def set_report(items):
    """items: [(name, hex, labs4)].  Returns per-vision and overall minima."""
    out = {}
    for vi, v in enumerate(VISIONS):
        best = None
        for (na, _, la), (nb, _, lb) in itertools.combinations(items, 2):
            d = ciede2000(la[vi], lb[vi])
            if best is None or d < best[0]:
                best = (d, na, nb)
        out[v] = best
    overall = min(out.values(), key=lambda t: t[0])
    ov = [v for v in VISIONS if out[v] is overall][0]
    out['__worst__'] = (overall[0], overall[1], overall[2], ov)
    return out


def meets_contrast(h, theme):
    t = THEMES[theme]
    return (contrast_ratio(h, t['ground']) >= MIN_CONTRAST
            and contrast_ratio(h, t['surface']) >= MIN_CONTRAST)


# ---------------------------------------------------------------- candidates


def candidates_for_hue(theme, hue_deg, l_step, c_step, c_min=MIN_CHROMA_SERIES,
                       l_band=None):
    """In-gamut, contrast-passing sRGB colours at (approximately) one hue.

    l_band, when given, is an inclusive (L*min, L*max) window that every
    candidate must sit inside - used to stop the optimiser from reaching for
    near-black and near-white members that score well and do not read as one
    family of chart series.
    """
    lo, hi = l_band if l_band else (12.0, 99.0)
    seen, out = set(), []
    L = lo
    while L <= hi + 1e-9:
        C = c_min
        while C <= 150.0:
            hx = lch_to_hex_if_in_gamut((L, C, hue_deg))
            C += c_step
            if hx is None or hx in seen:
                continue
            seen.add(hx)
            aL, aC, aH = lch(hx)
            if aC < c_min:
                continue
            if l_band and not (l_band[0] - 1e-9 <= aL <= l_band[1] + 1e-9):
                continue
            dh = abs((aH - hue_deg + 180.0) % 360.0 - 180.0)
            if dh > HUE_TOL:
                continue
            if not meets_contrast(hx, theme):
                continue
            out.append((hx, aL, aC, labs4(hx)))
        L += l_step
    return out


def neutral_candidates(theme, l_step=0.5, l_band=None):
    lo, hi = l_band if l_band else (12.0, 99.0)
    seen, out = set(), []
    L = lo
    while L <= hi + 1e-9:
        for hdeg in range(0, 360, 10):
            C = 0.0
            while C < MAX_CHROMA_NEUTRAL:
                hx = lch_to_hex_if_in_gamut((L, C, float(hdeg)))
                C += 1.0
                if hx is None or hx in seen:
                    continue
                seen.add(hx)
                aL, aC, aH = lch(hx)
                if aC >= MAX_CHROMA_NEUTRAL or not meets_contrast(hx, theme):
                    continue
                if l_band and not (l_band[0] - 1e-9 <= aL <= l_band[1] + 1e-9):
                    continue
                out.append((hx, aL, aC, labs4(hx)))
        L += l_step
    return out


# ---------------------------------------------------------------- search


def score(sel):
    """sel: list of candidate tuples.  min CIEDE2000 over all pairs x visions."""
    best = 1e9
    for a, b in itertools.combinations(sel, 2):
        d = pair_min(a[3], b[3])
        if d < best:
            best = d
    return best


def coord_descent(pools, sel, sweeps=8):
    """Improve one series at a time until nothing moves."""
    n = len(sel)
    for _ in range(sweeps):
        moved = False
        for i in range(n):
            others = [sel[j] for j in range(n) if j != i]
            base = score(others) if n > 2 else 1e9
            cur = min(base, min(pair_min(sel[i][3], o[3]) for o in others))
            best, bestv = sel[i], cur
            for cand in pools[i]:
                v = min(pair_min(cand[3], o[3]) for o in others)
                if v <= bestv:
                    continue
                v = min(v, base)
                if v > bestv:
                    bestv, best = v, cand
            if best is not sel[i]:
                sel[i] = best
                moved = True
        if not moved:
            break
    return sel


def search_subset(pools, restarts, kicks, seed):
    """Multi-start coordinate descent with basin hopping.

    Plain coordinate descent has a lot of local optima here, so after each
    descent converges we kick one or two series to a random candidate and
    descend again, keeping the best.  Per-subset RNG so the run is reproducible.
    """
    rng = random.Random(seed)
    n = len(pools)
    best_sel, best_val = None, -1.0
    for r in range(restarts):
        if r == 0:
            sel = [max(pools[0], key=lambda c: c[2])]
            for i in range(1, n):
                sel.append(max(pools[i],
                               key=lambda c: min(pair_min(c[3], s[3]) for s in sel)))
        else:
            sel = [rng.choice(p) for p in pools]
        sel = coord_descent(pools, sel)
        v = score(sel)
        if v > best_val:
            best_val, best_sel = v, list(sel)
    for _ in range(kicks):
        cand = list(best_sel)
        for _ in range(1 if rng.random() < 0.6 else 2):
            i = rng.randrange(n)
            cand[i] = rng.choice(pools[i])
        cand = coord_descent(pools, cand)
        v = score(cand)
        if v > best_val:
            best_val, best_sel = v, list(cand)
    return best_sel, best_val


def best_palette(theme, k, coarse_pools, fine_pool_fn, restarts):
    """Search every k-subset of the Okabe-Ito hues on the coarse grid, then
    refine the winner on a fine grid restricted to a neighbourhood."""
    names = list(OKABE_ITO)
    best = None
    for combo in itertools.combinations(names, k):
        pools = [coarse_pools[h] for h in combo]
        if any(not p for p in pools):
            continue
        sel, val = search_subset(pools, restarts, KICKS,
                                 sum(ord(ch) for ch in ''.join(combo)) + 7919 * SEED_SALT)
        if best is None or val > best[0]:
            best = (val, combo, sel)
    val, combo, sel = best
    # refinement: fine grid, restricted to +-6 L* and +-12 C* of the winner
    fpools = []
    for hname, s in zip(combo, sel):
        full = fine_pool_fn(hname)
        near = [c for c in full if abs(c[1] - s[1]) <= 6.0 and abs(c[2] - s[2]) <= 12.0]
        fpools.append(near or full)
    sel2 = coord_descent(fpools, list(sel))
    val2 = score(sel2)
    if val2 > val:
        val, sel = val2, sel2
    return val, combo, sel
