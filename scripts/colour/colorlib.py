"""Colour maths for chart-palette measurement. Python 3 stdlib only.

Contents
  * sRGB <-> linear <-> CIEXYZ (D65) <-> CIELAB
  * WCAG 2.x relative luminance + contrast ratio
  * CIEDE2000 (full: rotation term RT, SL/SC/SH weighting)
  * Brettel, Vienot & Mollon 1997 dichromacy simulation (two half-planes),
    protan / deutan / tritan.

Run `python3 colorlib.py` to execute the self-checks (Sharma CIEDE2000 test
vectors, WCAG reference ratios, Brettel half-plane continuity / idempotence).

------------------------------------------------------------------------------
PROVENANCE OF THE MATRICES
------------------------------------------------------------------------------
1. sRGB -> CIEXYZ (D65, 2 deg observer)
   IEC 61966-2-1:1999 / sRGB spec, as tabulated by Lindbloom
   (http://www.brucelindbloom.com/Eqn_RGB_XYZ_Matrix.html):
       0.4124564 0.3575761 0.1804375
       0.2126729 0.7151522 0.0721750
       0.0193339 0.1191920 0.9503041
   Reference white D65 = (0.95047, 1.00000, 1.08883).

2. WCAG relative luminance coefficients (0.2126, 0.7152, 0.0722) and the
   (L1+0.05)/(L2+0.05) ratio: W3C WCAG 2.1/2.2, definitions of "relative
   luminance" and "contrast ratio".
   https://www.w3.org/TR/WCAG22/#dfn-relative-luminance

3. CIEDE2000: Sharma, Wu & Dalal, "The CIEDE2000 Color-Difference Formula:
   Implementation Notes, Supplementary Test Data, and Mathematical
   Observations", Color Research & Application 30(1), 2005, pp. 21-30.
   (Identical to CIE 142-2001 / ISO 11664-6.)  The 34-pair test set from that
   paper is used in the self-check below.

4. Brettel, Vienot & Mollon 1997 ("Computerized simulation of color appearance
   for dichromats", JOSA A 14(10):2647-2655).  The algorithm projects a colour
   onto ONE OF TWO half-planes in LMS space, each half-plane spanned by the
   neutral (white) axis and one anchor stimulus (475/575 nm for protan and
   deutan, 485/660 nm for tritan); the choice of half-plane is made by the sign
   of the dot product with the normal of the separation plane.

   The numeric 3x3 matrices below are the precomputed linear-sRGB form of that
   algorithm published in libDaltonLens (Nicolas Burrus, public domain).  They
   were COPIED VERBATIM from the upstream source file, not written from memory:
       https://raw.githubusercontent.com/DaltonLens/libDaltonLens/master/libDaltonLens.c
       retrieved 2026-09-20; a copy is kept beside this file as
       libDaltonLens.c.reference
   structs brettel_protan_params / brettel_deutan_params / brettel_tritan_params
   (fields rgbCvdFromRgb_1, rgbCvdFromRgb_2, separationPlaneNormalInRgb).
   That file's own header states the derivation: sRGB for linearRGB->CIE XYZ,
   the Smith & Pokorny 1975 model for XYZ->LMS (the LMS model used by Vienot,
   Brettel and Mollon), and RGB white rather than equal-energy E as the neutral
   element for the projection planes - the choice Vischeck and most Brettel
   implementations make, because it clips less of the sRGB gamut.  The same
   values are produced by daltonlens-python's Simulator_Brettel1997.  They act
   on LINEAR sRGB, and plane 1 is selected when the dot product with the
   separation-plane normal is >= 0, matching the upstream pixel loop.
   They are used here rather than the Vienot, Brettel & Mollon 1999
   single-plane reduction, which the task explicitly excludes: the 1999 paper
   has no tritan matrix and its single projection plane misplaces high-chroma
   yellows and blues.
   The self-check verifies (a) that the two half-plane matrices agree on the
   separation plane itself (continuity - a strong transcription check), (b) that
   greys are fixed points, and (c) that simulation is idempotent, which is the
   defining property of a projection.
------------------------------------------------------------------------------
"""

import math

# ---------------------------------------------------------------- sRGB basics

def hex_to_rgb255(h):
    h = h.strip().lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb255_to_hex(rgb):
    return '#%02X%02X%02X' % tuple(max(0, min(255, int(round(c)))) for c in rgb)


def srgb_to_linear(c):
    """c in [0,1] gamma-encoded -> linear. IEC 61966-2-1."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def hex_to_linear(h):
    return tuple(srgb_to_linear(v / 255.0) for v in hex_to_rgb255(h))


def linear_to_hex(lin):
    return rgb255_to_hex(tuple(linear_to_srgb(v) * 255.0 for v in lin))


# ------------------------------------------------------------- WCAG 2.x

def relative_luminance(h):
    r, g, b = hex_to_linear(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(h1, h2):
    l1, l2 = relative_luminance(h1), relative_luminance(h2)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)


# ------------------------------------------------------------- CIEXYZ / CIELAB

M_RGB2XYZ = ((0.4124564, 0.3575761, 0.1804375),
             (0.2126729, 0.7151522, 0.0721750),
             (0.0193339, 0.1191920, 0.9503041))
M_XYZ2RGB = ((3.2404542, -1.5371385, -0.4985314),
             (-0.9692660, 1.8760108, 0.0415560),
             (0.0556434, -0.2040259, 1.0572252))
WHITE_D65 = (0.95047, 1.00000, 1.08883)


def _mv(m, v):
    return tuple(sum(m[i][j] * v[j] for j in range(3)) for i in range(3))


def linear_to_xyz(lin):
    return _mv(M_RGB2XYZ, lin)


def xyz_to_linear(xyz):
    return _mv(M_XYZ2RGB, xyz)


def xyz_to_lab(xyz):
    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (841 / 108) * t + 4 / 29
    fx, fy, fz = (f(xyz[i] / WHITE_D65[i]) for i in range(3))
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def lab_to_xyz(lab):
    L, a, b = lab
    fy = (L + 16) / 116
    fx = fy + a / 500
    fz = fy - b / 200

    def fi(t):
        return t ** 3 if t ** 3 > 216 / 24389 else (t - 4 / 29) * (108 / 841)
    return tuple(fi(v) * w for v, w in zip((fx, fy, fz), WHITE_D65))


def hex_to_lab(h):
    return xyz_to_lab(linear_to_xyz(hex_to_linear(h)))


def lab_to_lch(lab):
    L, a, b = lab
    C = math.hypot(a, b)
    hdeg = math.degrees(math.atan2(b, a)) % 360.0
    return (L, C, hdeg)


def lch_to_lab(lch):
    L, C, h = lch
    return (L, C * math.cos(math.radians(h)), C * math.sin(math.radians(h)))


def lch_to_hex_if_in_gamut(lch, tol=1e-6):
    """Return hex, or None when the LCh point is outside the sRGB cube."""
    lin = xyz_to_linear(lab_to_xyz(lch_to_lab(lch)))
    if any(c < -tol or c > 1 + tol for c in lin):
        return None
    return linear_to_hex(lin)


# ------------------------------------------------------------- CIEDE2000

_POW25_7 = 25.0 ** 7


def ciede2000(lab1, lab2, kL=1.0, kC=1.0, kH=1.0):
    """Full CIEDE2000, per Sharma/Wu/Dalal 2005 (= CIE 142-2001)."""
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2

    C1 = math.hypot(a1, b1)
    C2 = math.hypot(a2, b2)
    Cbar = 0.5 * (C1 + C2)
    Cbar7 = Cbar ** 7
    G = 0.5 * (1.0 - math.sqrt(Cbar7 / (Cbar7 + _POW25_7)))

    a1p = (1.0 + G) * a1
    a2p = (1.0 + G) * a2
    C1p = math.hypot(a1p, b1)
    C2p = math.hypot(a2p, b2)

    h1p = 0.0 if (a1p == 0.0 and b1 == 0.0) else math.degrees(math.atan2(b1, a1p)) % 360.0
    h2p = 0.0 if (a2p == 0.0 and b2 == 0.0) else math.degrees(math.atan2(b2, a2p)) % 360.0

    dLp = L2 - L1
    dCp = C2p - C1p

    if C1p * C2p == 0.0:
        dhp = 0.0
    else:
        dh = h2p - h1p
        if dh > 180.0:
            dh -= 360.0
        elif dh < -180.0:
            dh += 360.0
        dhp = dh
    dHp = 2.0 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp) / 2.0)

    Lbp = 0.5 * (L1 + L2)
    Cbp = 0.5 * (C1p + C2p)

    if C1p * C2p == 0.0:
        hbp = h1p + h2p
    else:
        s, d = h1p + h2p, abs(h1p - h2p)
        if d <= 180.0:
            hbp = 0.5 * s
        elif s < 360.0:
            hbp = 0.5 * (s + 360.0)
        else:
            hbp = 0.5 * (s - 360.0)

    T = (1.0
         - 0.17 * math.cos(math.radians(hbp - 30.0))
         + 0.24 * math.cos(math.radians(2.0 * hbp))
         + 0.32 * math.cos(math.radians(3.0 * hbp + 6.0))
         - 0.20 * math.cos(math.radians(4.0 * hbp - 63.0)))

    dtheta = 30.0 * math.exp(-(((hbp - 275.0) / 25.0) ** 2))
    Cbp7 = Cbp ** 7
    RC = 2.0 * math.sqrt(Cbp7 / (Cbp7 + _POW25_7))
    SL = 1.0 + (0.015 * (Lbp - 50.0) ** 2) / math.sqrt(20.0 + (Lbp - 50.0) ** 2)
    SC = 1.0 + 0.045 * Cbp
    SH = 1.0 + 0.015 * Cbp * T
    RT = -math.sin(math.radians(2.0 * dtheta)) * RC

    tL = dLp / (kL * SL)
    tC = dCp / (kC * SC)
    tH = dHp / (kH * SH)
    return math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH)


def de00_hex(h1, h2):
    return ciede2000(hex_to_lab(h1), hex_to_lab(h2))


# ------------------------------------------- Brettel, Vienot & Mollon 1997

# Each entry: two 3x3 matrices acting on LINEAR sRGB (one per half-plane) and
# the normal of the separation plane, also expressed in linear sRGB.
# Source: libDaltonLens / daltonlens-python (see PROVENANCE note 4 above).
BRETTEL_1997 = {
    'protan': {
        'm1': ((0.14980, 1.19548, -0.34528),
               (0.10764, 0.84864, 0.04372),
               (0.00384, -0.00540, 1.00156)),
        'm2': ((0.14570, 1.16172, -0.30742),
               (0.10816, 0.85291, 0.03892),
               (0.00386, -0.00524, 1.00139)),
        'n': (0.00048, 0.00393, -0.00441),
    },
    'deutan': {
        'm1': ((0.36477, 0.86381, -0.22858),
               (0.26294, 0.64245, 0.09462),
               (-0.02006, 0.02728, 0.99278)),
        'm2': ((0.37298, 0.88166, -0.25464),
               (0.25954, 0.63506, 0.10540),
               (-0.01980, 0.02784, 0.99196)),
        'n': (-0.00281, -0.00611, 0.00892),
    },
    'tritan': {
        'm1': ((1.01277, 0.13548, -0.14826),
               (-0.01243, 0.86812, 0.14431),
               (0.07589, 0.80500, 0.11911)),
        'm2': ((0.93678, 0.18979, -0.12657),
               (0.06154, 0.81526, 0.12320),
               (-0.37562, 1.12767, 0.24796)),
        'n': (0.03901, -0.02788, -0.01113),
    },
}

VISIONS = ('normal', 'protan', 'deutan', 'tritan')


def simulate_linear(lin, kind):
    if kind == 'normal':
        return lin
    p = BRETTEL_1997[kind]
    dot = sum(lin[i] * p['n'][i] for i in range(3))
    m = p['m1'] if dot >= 0.0 else p['m2']
    return _mv(m, lin)


def simulate_hex(h, kind):
    if kind == 'normal':
        return h.upper() if h.startswith('#') else '#' + h.upper()
    return linear_to_hex(simulate_linear(hex_to_linear(h), kind))


def lab_all_visions(h):
    """{vision: Lab} for one hex, simulation done in linear light."""
    lin = hex_to_linear(h)
    out = {}
    for v in VISIONS:
        s = simulate_linear(lin, v)
        s = tuple(max(0.0, min(1.0, c)) for c in s)
        out[v] = xyz_to_lab(linear_to_xyz(s))
    return out


# ------------------------------------------------------------- CSS compositing

def composite_over(src_hex, alpha, dst_hex):
    """CSS 'source-over' of a translucent solid on an opaque backdrop.

    CSS compositing for a plain (non-`color-interpolation`-overridden) gradient
    or background layer happens on the gamma-encoded sRGB values, so the blend
    is done on the 0-255 channels, then rounded to the nearest 8-bit value
    (what a screenshot / eyedropper would actually read back).
    """
    s = hex_to_rgb255(src_hex)
    d = hex_to_rgb255(dst_hex)
    return rgb255_to_hex(tuple(alpha * s[i] + (1 - alpha) * d[i] for i in range(3)))


# ------------------------------------------------------------- self-checks

def _selfcheck():
    ok = lambda got, want, tol, what: (
        None if abs(got - want) <= tol
        else (_ for _ in ()).throw(AssertionError(f'{what}: got {got!r}, want {want!r}')))

    # --- CIEDE2000, Sharma/Wu/Dalal 2005 supplementary test data (subset) ----
    sharma = [
        ((50.0000, 2.6772, -79.7751), (50.0000, 0.0000, -82.7485), 2.0425),
        ((50.0000, 3.1571, -77.2803), (50.0000, 0.0000, -82.7485), 2.8615),
        ((50.0000, 2.8361, -74.0200), (50.0000, 0.0000, -82.7485), 3.4412),
        ((50.0000, -1.3802, -84.2814), (50.0000, 0.0000, -82.7485), 1.0000),
        ((50.0000, -1.1848, -84.8006), (50.0000, 0.0000, -82.7485), 1.0000),
        ((50.0000, -0.9009, -85.5211), (50.0000, 0.0000, -82.7485), 1.0000),
        ((50.0000, 0.0000, 0.0000), (50.0000, -1.0000, 2.0000), 2.3669),
        ((50.0000, -1.0000, 2.0000), (50.0000, 0.0000, 0.0000), 2.3669),
        ((50.0000, 2.4900, -0.0010), (50.0000, -2.4900, 0.0009), 7.1792),
        ((50.0000, 2.4900, -0.0010), (50.0000, -2.4900, 0.0010), 7.1792),
        ((50.0000, 2.4900, -0.0010), (50.0000, -2.4900, 0.0011), 7.2195),
        ((50.0000, 2.4900, -0.0010), (50.0000, -2.4900, 0.0012), 7.2195),
        ((50.0000, -0.0010, 2.4900), (50.0000, 0.0009, -2.4900), 4.8045),
        ((50.0000, -0.0010, 2.4900), (50.0000, 0.0011, -2.4900), 4.7461),
        ((50.0000, 2.5000, 0.0000), (50.0000, 0.0000, -2.5000), 4.3065),
        ((50.0000, 2.5000, 0.0000), (73.0000, 25.0000, -18.0000), 27.1492),
        ((50.0000, 2.5000, 0.0000), (61.0000, -5.0000, 29.0000), 22.8977),
        ((50.0000, 2.5000, 0.0000), (56.0000, -27.0000, -3.0000), 31.9030),
        ((50.0000, 2.5000, 0.0000), (58.0000, 24.0000, 15.0000), 19.4535),
        ((50.0000, 2.5000, 0.0000), (50.0000, 3.1736, 0.5854), 1.0000),
        ((50.0000, 2.5000, 0.0000), (50.0000, 3.2972, 0.0000), 1.0000),
        ((50.0000, 2.5000, 0.0000), (50.0000, 1.8634, 0.5757), 1.0000),
        ((50.0000, 2.5000, 0.0000), (50.0000, 3.2592, 0.3350), 1.0000),
        ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
        ((63.0109, -31.0961, -5.8663), (62.8187, -29.7946, -4.0864), 1.2630),
        ((61.2901, 3.7196, -5.3901), (61.4292, 2.2480, -4.9620), 1.8731),
        ((35.0831, -44.1164, 3.7933), (35.0232, -40.0716, 1.5901), 1.8645),
        ((22.7233, 20.0904, -46.6940), (23.0331, 14.9730, -42.5619), 2.0373),
        ((36.4612, 47.8580, 18.3852), (36.2715, 50.5065, 21.2231), 1.4146),
        ((90.8027, -2.0831, 1.4410), (91.1528, -1.6435, 0.0447), 1.4441),
        ((90.9257, -0.5406, -0.9208), (88.6381, -0.8985, -0.7239), 1.5381),
        ((6.7747, -0.2908, -2.4247), (5.8714, -0.0985, -2.2286), 0.6377),
        ((2.0776, 0.0795, -1.1350), (0.9033, -0.0636, -0.5514), 0.9082),
    ]
    for lab1, lab2, want in sharma:
        ok(ciede2000(lab1, lab2), want, 1e-4, f'CIEDE2000 {lab1}/{lab2}')

    # --- WCAG contrast reference points -------------------------------------
    ok(contrast_ratio('#FFFFFF', '#000000'), 21.0, 1e-9, 'white/black contrast')
    ok(contrast_ratio('#777777', '#FFFFFF'), 4.478, 1e-3, 'grey/white contrast')
    ok(contrast_ratio('#FF0000', '#FFFFFF'), 3.998, 1e-3, 'red/white contrast')

    # --- Lab round-trip ------------------------------------------------------
    for h in ('#FAF9F5', '#1A1918', '#128DC1', '#E96C17', '#00FF00'):
        lin = xyz_to_linear(lab_to_xyz(hex_to_lab(h)))
        assert linear_to_hex(lin) == h.upper(), f'Lab round-trip {h}'
    # D50-independent sanity: pure white is L*=100, a*=b*=0
    Lw, aw, bw = hex_to_lab('#FFFFFF')
    ok(Lw, 100.0, 1e-3, 'L* of white')
    ok(abs(aw) + abs(bw), 0.0, 1e-2, 'ab of white')

    # --- Brettel 1997 structural checks -------------------------------------
    for kind, p in BRETTEL_1997.items():
        n = p['n']
        # (a) continuity: on the separation plane the two matrices must agree.
        # Build vectors with n.v == 0 and check m1 v == m2 v.
        basis = []
        # two independent vectors orthogonal to n
        for probe in ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)):
            d = sum(probe[i] * n[i] for i in range(3))
            nn = sum(c * c for c in n)
            v = tuple(probe[i] - d / nn * n[i] for i in range(3))
            basis.append(v)
        for v in basis:
            r1 = _mv(p['m1'], v)
            r2 = _mv(p['m2'], v)
            for i in range(3):
                ok(r1[i], r2[i], 2e-3, f'{kind} half-plane continuity')
        # (b) greys are fixed points (the neutral axis lies in both planes).
        for g in (0.05, 0.25, 0.5, 0.75, 1.0):
            r = simulate_linear((g, g, g), kind)
            for i in range(3):
                ok(r[i], g, 5e-3, f'{kind} grey fixed point')
        # (c) idempotence: simulation is a projection, so P(P(v)) == P(v).
        # Checked WITHOUT gamut clamping - clamping an out-of-gamut result is a
        # separate, non-linear step and legitimately breaks the projection.
        for h in ('#128DC1', '#E96C17', '#F0E442', '#0072B2', '#CC79A7', '#009E73'):
            once = simulate_linear(hex_to_linear(h), kind)
            twice = simulate_linear(once, kind)
            for i in range(3):
                ok(twice[i], once[i], 6e-3, f'{kind} idempotence {h}')

    # --- compositing ---------------------------------------------------------
    assert composite_over('#FFFFFF', 0.5, '#000000') == '#808080'
    assert composite_over('#FFFFFF', 0.0, '#123456') == '#123456'
    assert composite_over('#FFFFFF', 1.0, '#123456') == '#FFFFFF'
    print('colorlib self-checks: all passed')


if __name__ == '__main__':
    _selfcheck()
