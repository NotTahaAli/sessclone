# Colour measurement

The numbers in `docs/design/design-system.md` come from these scripts, not from
recall. Everything here is stdlib `python3`, no install step.

```bash
python3 scripts/colour/colorlib.py   # self-checks: CIEDE2000 against the
                                     # Sharma, Wu & Dalal 2005 test data, and
                                     # the dichromacy transform's continuity
python3 scripts/colour/band.py       # the chart palette search, banded
```

`colorlib.py` carries WCAG 2.x contrast, CIELAB, CIEDE2000, and the Brettel,
Viénot and Mollon 1997 two-half-plane simulation for protanopia, deuteranopia
and tritanopia. The dichromacy matrices are copied verbatim from libDaltonLens
rather than written from memory; the 1999 single-plane reduction is deliberately
not used, because it defines no tritan transform.

`palette_search.py` generates candidates at a fixed hue and searches for the
largest achievable minimum CIEDE2000 across normal vision and all three
dichromacies at once. `band.py` runs that search under the lightness band the
design system uses, and prints the tables the spec quotes.

A palette change is a change to these outputs. Re-run them rather than editing a
number in the spec.
