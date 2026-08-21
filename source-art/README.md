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
| diocese-midlands | 121 KB | 31 KB |
| **total** | **3,833 KB** | **139 KB** |

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
