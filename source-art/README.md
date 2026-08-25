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

## km-seal is also cropped, for the same reason as diocese-midlands

The Kidane Mihret crest as supplied is a full seal: a Coptic cross on a cream
disc inside a blue ring reading *Debremedhánit · Kidane Mehret · Eritrean
Orthodox Tewahedo Church · London*. A club crest is drawn at 22–62px, where
that ring is texture rather than words.

`web/crests/km.webp` is the cross alone. The geometry, so it can be redone:

| | |
|---|---|
| source | the supplied 3210×3736 JPEG (12 MP) |
| centre | **(1570, 1809)** — the centre of the CROSS |
| radius | **925**, circular mask |
| output | 224×224 webp, quality 0.92, 21 KB |

The cross sits **13px above the seal's own centre** (1568, 1822), which is why
a seal-centred crop looks bottom-heavy — the first attempt clipped the lower
point. The radius is bounded on both sides: the cross tips reach 886, and the
nearest lettering is "LONDON", set on its own inner arc at 971 from the cross
centre. 925 sits between them.

Rendered at 4× with a hard clip and then downscaled. Both GDI+ and canvas
clipping are hard-edged; the downscale is what gives the alpha edge its
anti-aliasing.

**The gold rim is added, not cropped.** The club colour is `#FFFFFF` and the
cropped disc is cream, so without an edge the crest dissolves into its own half
of the match header. It is the seal's own gold — `#FAD016`, averaged over 947
pixels of the ring it replaces — drawn 24px wide at 4×. Same rule as
`smpk.webp`: separation is fixed in the asset, never in CSS.

Measured against white it reads across 52% of the frame at 44, 24 and 22px
alike; the KM monogram it replaced managed 20.1%.

**`km-seal.webp` here is the uncropped seal at 1024px**, where the lettering is
still readable, and must stay that way.

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
