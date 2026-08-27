# Solvigo Airways — final brand asset package

## Contents
- svg/app-icon-{mono,ember,graphite}.svg — embossed app icons on the dark squircle plate (reflective rim, internal lighting, fold shadows)
- svg/jet-embossed-{mono,ember,graphite}.svg — the same embossed jets bare, transparent background
- svg/lockup-{mono,ember}-on-{dark,light}.svg — embossed plate + wordmark + tagline, text colored for dark or light surfaces
- svg/app-icon-flat-{mono,ember,graphite}.svg — small-format icons: two solid faces only, enlarged jet, no gradients/folds — reads down to 16 px, flat #201F1E plate
- svg/jet-flat-{mono,ember,graphite}.svg — the flat two-tone jet bare, transparent background
- svg/jet-outline-{mono,ember,graphite}.svg — stroke-only jet (silhouette + fold lines), transparent background
- svg/app-icon-outline-{mono,ember}.svg — outline jet on the flat #201F1E plate
- svg/mark-{ember,white,black}.svg — flat jet mark for UI use, transparent background
- png/ — rasters: app icons at 1024 & 256 px, embossed jets at 1024 px (transparent), lockups at 2x, flat marks at 1024 px, flat small-format icons at 128/64/32 px

## Colorways
- mono — white paper jet, closest to a classic mark
- ember — ember jet (#FF6420 → #DE4400 faces on #F54E00 base), hero use
- graphite — dark grey jet for quiet surfaces

## Color tokens
- Signal orange (flat mark): #F54E00 / #C23E00
- Ember faces: #FFA05C → #F54E00 and #FF7A2E → #C23E00
- Plate: #2E2E2C → #131312, luminous rim from #FFFFFF 75% (top) to 30% (bottom kick)
- Ink text: #141413 · Paper text: #F5F4EF · Muted: #6E6C66 (light) / #8D8A83 (dark)

## Icon anatomy
Squircle rx 58/256 with a blurred reflective rim and top sheen. The jet is lit from the top-left: gradient faces, tight cast shadow, inner edge highlight/shadow, a radial internal light, and fold shadows darkest along the centre crease — the paper-plane spine.

## Type
Wordmark: Jost SemiBold (fallback Futura), tagline Jost Medium tracked wide, all caps.
Lockup SVGs reference Jost — install the font or convert text to outlines in tools without it. The PNG lockups are pre-rendered with the correct font.

## Clear space & minimum size
Clear space: half the plate width on all sides. Minimum plate size for the embossed icon: 48 px — below that, switch to the flat small-format icon (app-icon-flat-*), which holds down to 16 px.

## Wordmarks (plane as A)
PNG only (typeset in Jost 600; jet tilted 30°). Each in two versions: with "BY SOLVIGO" caption and `-nocap` without.

- wordmark-flat-on-dark / -on-light — two-tone flat jet
- wordmark-depth-on-dark / -on-light — flat with directional gradients + fold shadow
- wordmark-embossed-mono / -ember — full embossed 3d jet
- wordmark-outline-mono / -ember — tapered outline jet

All outline assets (svg + png) use the tapered-at-nose geometry with mitered joints.
