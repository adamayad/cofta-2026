# Source artwork

Full-resolution originals of the badges and crests, kept out of `web/` so
they are preserved in the repo without being deployed — everything under
`web/` is published by Cloudflare Pages whether or not anything references it.

The files served to phones live in `web/comps/`, `web/crests/archive/` and
`web/diocese-midlands.webp`, downscaled from these.

## Why they are downscaled

These arrived at around **3464×3464**, roughly 12 megapixels, and are drawn at
**24–46px**. That is not a trivial difference:

| | as supplied | as served |
|---|---|---|
| four competition badges | 2,437 KB | 72 KB |
| st-mina, gg-b | 1,275 KB | 36 KB |
| diocese-midlands | 121 KB | 35 KB |
| **total** | **3,833 KB** | **143 KB** |

Download weight is the smaller half of it. Decoding a 12-megapixel image costs
roughly 48 MB of memory *per image* regardless of the size it is painted at,
and the archive shows several at once — on a cheap Android at a venue that is
the difference between a page that scrolls and one that stutters.

224px is the target: eight times the ~28px the badges actually render at, so
still crisp on any retina display, and it matches the archive crests already
in the repo.

## Redoing it

There is no image tooling on the build machine (no ImageMagick, no cwebp, no
node, no python). The downscale was done in the browser — fetch, draw to an
`OffscreenCanvas` at the target size, `convertToBlob({type:'image/webp',
quality:0.92})` — and POSTed to a temporary local sink so several megabytes of
base64 never had to cross the agent transcript. `scratchpad/upload.ps1` is
that sink if it is needed again.

## diocese-midlands is also cropped, not only downscaled

The seal as supplied is a coat of arms inside a ring of lettering. At the 24px
it is drawn at, the ring is sub-pixel — it averages to grey haze and leaves the
emblem occupying about a third of the frame, which is why it read as an empty
smudge in the masthead even though the file was loading correctly.

The served file is a square crop of the central emblem: centre (294, 295) of
the 587×587 original, half-side 180, resampled to 192×192. That doubles the
emblem on screen — dark pixels in a 24×24 render go from 86 to 158, against
100 for the London crest.

**The original here is the uncropped seal and must stay that way.** The crop
is a rendering decision for one small slot, not a correction to the artwork;
anything that needs the full seal at a legible size takes it from this file.

## km is served WHOLE, and the diocese-midlands rule did NOT transfer

The Kidane Mihret badge is a Coptic cross on a cream disc inside a blue ring
reading *Debremedhánit · Kidane Mehret · Eritrean Orthodox Tewahedo Church ·
London*. `web/crests/km.webp` is all of it: circular mask at **r = 1484**
around centre **(1568, 1822)**, output 224×224 webp at quality 0.92, 26 KB.
The outer gold edge sits at 1479-1483 and the soft drop shadow beyond it starts
at ~1487 - excluded on purpose, because the app applies its own shadow in CSS.

**It was shipped cropped to the cross first, and that was a mistake.** The
reasoning borrowed from diocese-midlands above: ring lettering is illegible at
small sizes, so crop to the emblem. Three things said the precedent did not
transfer.

1. **The blue ring is the badge.** It is the club's dominant colour and what
   identifies it on a 24px tile. Unreadable text on a crest at that size is
   what every real football badge does.
2. **The crop needed an invented gold rim.** The club colour is `#FFFFFF` and
   the cropped disc is cream, so removing the ring left the crest with no edge
   and a hairline had to be fabricated to replace it. Having to invent a
   substitute for what you just deleted is the tell.
3. **It measured worse at every size.** Ink against white, whole vs cropped:

   | | 62px | 44px | 24px | 22px |
   |---|---|---|---|---|
   | whole badge | 61.9% | 61.5% | 62.7% | 64.3% |
   | cropped | 51.9% | 51.9% | 52.4% | 51.7% |
   | old KM monogram | - | 20.1% | - | - |

What made diocese-midlands different: a fine-detailed coat of arms filling a
third of its frame, in a slot only ever drawn at 24px. Here the emblem is a
bold cross and the largest slot is 62px. Check that a precedent's conditions
hold before borrowing its conclusion.

**`km-seal.webp` is the supplied seal at 1024px.** The served file is masked
and downscaled; anything needing the original geometry starts here.

## There IS one piece of image tooling after all

`System.Drawing` via PowerShell decodes JPEG and PNG and encodes PNG, which is
enough to crop, resample and inspect candidates without a browser — and PNG
output can be read back and looked at directly, which is how the crop above was
chosen. **It cannot decode or encode WebP**; `Image::FromFile` on a `.webp`
throws a misleading "Out of memory". WebP encoding still needs the browser and
`scratchpad/upload.ps1`.

**The sink takes its destination from the URL path and writes the raw body** —
`POST http://localhost:8100/web/crests/km.webp` with the blob itself. There is
no JSON envelope and no base64.
