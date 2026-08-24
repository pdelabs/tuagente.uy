#!/usr/bin/env python3
"""Extract a brand's raw visual facts from its own website.

Writes `brand.json` plus downloaded logo and font files into the brand folder.
This script only records what it can OBSERVE. Anything that takes judgement
(voice, misuse rules, image style) is left in `gaps` for a human to answer --
never guessed, because a brand kit that asserts an undecided value is worse
than an incomplete one.

Standard library only, on purpose: this runs inside a customer's agent, where
installing packages at runtime is both fragile and a way for third-party code
to enter the container.
"""

import argparse
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (compatible; tuagente-brand-kit/1.0; +https://tuagente.uy)"
TIMEOUT = 20
MAX_PAGE_BYTES = 4 * 1024 * 1024
MAX_ASSET_BYTES = 3 * 1024 * 1024
MAX_STYLESHEETS = 8
SCHEMA_VERSION = 1

# Role names we try to fill. Order matters: it is the order a kit reads best in.
ROLE_ORDER = ["primary", "secondary", "accent", "background", "surface", "text", "muted"]

# CSS custom properties are the single strongest signal a site gives us about
# what a colour is FOR. A site that says `--brand-primary` has already answered
# the question that counting pixels only approximates.
# Matched against whole WORDS of the variable name, never as substrings. CSS-in-JS
# build tools emit names like `--_1dm5szbg`, and a substring match reads the tail
# as "bg" and promotes a random tinted colour to "the background" -- which then
# poisons every contrast number derived from it. Seen on nulab.com.
ROLE_HINTS = [
    ("primary", {"brand", "primary", "main", "principal"}),
    ("secondary", {"secondary", "secundario"}),
    ("accent", {"accent", "highlight", "cta", "action"}),
    ("background", {"background", "bg", "canvas", "page"}),
    ("surface", {"surface", "card", "panel", "elevated"}),
    ("text", {"text", "ink", "foreground", "fg"}),
    ("muted", {"muted", "subtle", "gray", "grey", "neutral"}),
]

HEX_RE = re.compile(r"#([0-9a-fA-F]{3,8})\b")
RGB_RE = re.compile(r"rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)", re.I)
VAR_RE = re.compile(r"(--[\w-]+)\s*:\s*([^;}]+)[;}]")
FONT_FACE_RE = re.compile(r"@font-face\s*\{([^}]*)\}", re.I | re.S)
FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;}]+)", re.I)
SRC_URL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)(?:\s*format\(\s*['\"]?([\w-]+))?", re.I)
DECL_RE = re.compile(r"([-\w]+)\s*:\s*([^;{}]+)", re.I)


# --------------------------------------------------------------------------- net


def fetch(url, max_bytes=MAX_PAGE_BYTES):
    """GET a URL. Returns (body_bytes, final_url, content_type) or raises."""
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError(f"unsupported scheme: {url[:40]}")
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=TIMEOUT, context=context) as response:
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            body = body[:max_bytes]
        return body, response.geturl(), (response.headers.get("Content-Type") or "")


def fetch_text(url):
    body, final_url, _ = fetch(url)
    for encoding in ("utf-8", "latin-1"):
        try:
            return body.decode(encoding), final_url
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", "replace"), final_url


# ------------------------------------------------------------------------ colour


def _clamp(value):
    return max(0, min(255, int(round(value))))


def normalize_color(raw):
    """Return #rrggbb for a CSS colour, or None when it is not a solid colour."""
    raw = raw.strip()
    match = HEX_RE.fullmatch(raw) or HEX_RE.match(raw)
    if match:
        digits = match.group(1)
        if len(digits) == 3:
            return "#" + "".join(c * 2 for c in digits).lower()
        if len(digits) in (6, 8):  # 8 = #rrggbbaa, we keep the opaque part
            return "#" + digits[:6].lower()
        return None
    match = RGB_RE.match(raw)
    if match:
        r, g, b = (_clamp(float(match.group(i))) for i in (1, 2, 3))
        return f"#{r:02x}{g:02x}{b:02x}"
    return None


def luminance(hex_color):
    """WCAG 2.1 relative luminance."""
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))

    def channel(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(a, b):
    la, lb = luminance(a), luminance(b)
    lighter, darker = max(la, lb), min(la, lb)
    return round((lighter + 0.05) / (darker + 0.05), 2)


def chroma(hex_color):
    """Absolute colourfulness, 0..1.

    Deliberately NOT HSV saturation. HSV divides by the brightest channel, so a
    near-black ink like #14131f scores 0.39 and reads as "colourful", which is
    how an ink ends up classified as an accent. max-min over the full range
    behaves at every luminance: #14131f -> 0.05, #5b4be8 -> 0.62.
    """
    channels = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    return round((max(channels) - min(channels)) / 255, 3)


# --------------------------------------------------------------------------- css


def collect_stylesheets(html, base_url):
    """Inline <style> blocks plus up to MAX_STYLESHEETS linked sheets."""
    sheets = [("inline", block) for block in re.findall(r"<style[^>]*>(.*?)</style>", html, re.I | re.S)]
    hrefs = re.findall(r"<link[^>]+rel=['\"]?stylesheet['\"]?[^>]*>", html, re.I)
    urls = []
    for tag in hrefs:
        match = re.search(r"href\s*=\s*['\"]([^'\"]+)['\"]", tag, re.I)
        if match:
            urls.append(urllib.parse.urljoin(base_url, match.group(1)))
    # Google Fonts stylesheets are worth fetching: they name the real font files.
    for url in urls[:MAX_STYLESHEETS]:
        try:
            text, _ = fetch_text(url)
            sheets.append((url, text))
        except (urllib.error.URLError, ValueError, OSError, TimeoutError):
            continue
    return sheets, urls


def parse_css(sheets):
    """Pull custom properties, colour usage in context, font faces and stacks."""
    variables, colors, faces, stacks = {}, {}, [], []
    for origin, css in sheets:
        for name, value in VAR_RE.findall(css):
            color = normalize_color(value)
            if color:
                variables.setdefault(name.lower(), color)
        for block in FONT_FACE_RE.findall(css):
            family = FONT_FAMILY_RE.search(block)
            sources = SRC_URL_RE.findall(block)
            if family:
                faces.append({
                    "family": family.group(1).strip().strip("'\""),
                    "sources": [{"url": u, "format": f or ""} for u, f in sources],
                    "origin": origin,
                })
        for prop, value in DECL_RE.findall(css):
            prop = prop.lower()
            if prop == "font-family":
                stack = [p.strip().strip("'\"") for p in value.split(",") if p.strip()]
                if stack:
                    stacks.append(stack)
            elif "color" in prop or prop in ("background", "border", "fill", "stroke"):
                for token in re.findall(r"#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)", value):
                    color = normalize_color(token)
                    if not color:
                        continue
                    entry = colors.setdefault(color, {"count": 0, "props": {}})
                    entry["count"] += 1
                    entry["props"][prop] = entry["props"].get(prop, 0) + 1
    return variables, colors, faces, stacks


def infer_roles(variables, colors):
    """Assign colours to roles. Declared custom properties beat frequency."""
    def words(name):
        return {w for w in re.split(r"[^a-z0-9]+", name.lower()) if w and not re.search(r"\d", w)}

    # A brand colour is saturated AND actually visible as a hue.
    def is_brand_hue(color):
        return chroma(color) >= 0.15 and 0.06 <= luminance(color) <= 0.90

    roles, why = {}, {}
    for role, keywords in ROLE_HINTS:
        for name, color in variables.items():
            if role in roles:
                break
            if words(name) & keywords:
                roles[role] = color
                why[role] = f"variable CSS {name}"

    # Sanity check on what the variables claimed. Sites with inverted sections
    # declare things like `--color-primary: #f5f5ff` for text on a dark hero;
    # honouring that verbatim publishes a kit saying the brand colour is white.
    # If the declared value has no hue, we drop it and let frequency decide.
    for role in ("primary", "accent", "secondary"):
        if role in roles and not is_brand_hue(roles[role]):
            why[f"{role}_descartado"] = (
                f"{why.get(role, '')} decia {roles[role]}, sin color suficiente para ser marca")
            del roles[role]
            why.pop(role, None)

    ranked = sorted(colors.items(), key=lambda kv: -kv[1]["count"])

    def used_on(data, *props):
        return any(data["props"].get(p) for p in props)

    vivid = [(c, d) for c, d in ranked if is_brand_hue(c)]
    if "primary" not in roles and vivid:
        roles["primary"] = vivid[0][0]
        why["primary"] = f"color con hue mas usado ({vivid[0][1]['count']} veces)"
    if "accent" not in roles and len(vivid) > 1:
        roles["accent"] = vivid[1][0]
        why["accent"] = "segundo color con hue mas usado"

    # Text and background are decided by WHERE they are used, not by how dark
    # they are: the most-used dark colour on a `color:` declaration is the ink,
    # even when some stylesheet also mentions pure black once.
    # Ink and ground are near-neutral: a tinted lilac that a site uses for cards
    # is not the background, and the brand colour used on headings is not the
    # ink. Try the strict neutral filter first, then relax it rather than
    # inventing a value. Already-assigned colours are off the table -- one
    # colour cannot be both the brand and the body text.
    def pick(candidates, taken, thresholds=(0.05, 0.15, 0.35, 1.0)):
        for max_chroma in thresholds:
            for color, data in candidates:
                if color not in taken and chroma(color) <= max_chroma:
                    return color, data
        return None, None

    if "text" not in roles:
        inks = [(c, d) for c, d in ranked if used_on(d, "color") and luminance(c) < 0.45]
        color, data = pick(inks, set(roles.values()))
        if color:
            roles["text"] = color
            why["text"] = f"color de texto neutro mas usado ({data['count']} veces)"
    if "background" not in roles:
        grounds = [(c, d) for c, d in ranked
                   if used_on(d, "background", "background-color") and luminance(c) > 0.55]
        # Only near-neutral counts here, with no relaxation: plenty of sites
        # never declare white and simply inherit it, and relaxing the threshold
        # promotes whatever tinted card colour they DID declare to "the
        # background" -- which then poisons every contrast number below.
        color, data = pick(grounds, set(roles.values()), thresholds=(0.05, 0.10))
        if color:
            roles["background"] = color
            why["background"] = f"fondo neutro mas usado ({data['count']} veces)"
        else:
            roles["background"] = "#ffffff"
            why["background"] = "el sitio no declara un fondo neutro: blanco por defecto del navegador"
    return roles, why


# -------------------------------------------------------------------------- html


def meta_content(html, *keys):
    for key in keys:
        pattern = (
            r"<meta[^>]+(?:property|name)\s*=\s*['\"]" + re.escape(key) +
            r"['\"][^>]*content\s*=\s*['\"]([^'\"]*)['\"]"
        )
        match = re.search(pattern, html, re.I)
        if match and match.group(1).strip():
            return match.group(1).strip()
        pattern = (
            r"<meta[^>]+content\s*=\s*['\"]([^'\"]*)['\"][^>]*(?:property|name)\s*=\s*['\"]" +
            re.escape(key) + r"['\"]"
        )
        match = re.search(pattern, html, re.I)
        if match and match.group(1).strip():
            return match.group(1).strip()
    return ""


def find_logo_candidates(html, base_url):
    """Icons and images that look like a logo, best guess first."""
    found = []
    for rel in ("apple-touch-icon", "icon", "shortcut icon", "mask-icon"):
        for tag in re.findall(r"<link[^>]+>", html, re.I):
            if not re.search(r"rel\s*=\s*['\"]?[^'\">]*" + re.escape(rel), tag, re.I):
                continue
            match = re.search(r"href\s*=\s*['\"]([^'\"]+)['\"]", tag, re.I)
            if match:
                found.append((rel, urllib.parse.urljoin(base_url, match.group(1))))
    og = meta_content(html, "og:image", "twitter:image")
    if og:
        found.append(("og:image", urllib.parse.urljoin(base_url, og)))
    for tag in re.findall(r"<img[^>]+>", html, re.I):
        if not re.search(r"logo|isotipo|marca|brand", tag, re.I):
            continue
        match = re.search(r"src\s*=\s*['\"]([^'\"]+)['\"]", tag, re.I)
        if match:
            found.append(("img[logo]", urllib.parse.urljoin(base_url, match.group(1))))
    seen, unique = set(), []
    for kind, url in found:
        if url not in seen:
            seen.add(url)
            unique.append({"kind": kind, "url": url})
    return unique


# ------------------------------------------------------------------------ assets


def safe_name(url, fallback):
    name = os.path.basename(urllib.parse.urlparse(url).path) or fallback
    name = re.sub(r"[^\w.\-]", "_", name)[:80]
    return name or fallback


def download(url, folder, fallback):
    """Save one asset. Returns its record, or None when it could not be saved."""
    try:
        body, final_url, content_type = fetch(url, MAX_ASSET_BYTES)
    except (urllib.error.URLError, ValueError, OSError, TimeoutError):
        return None
    if not body:
        return None
    folder.mkdir(parents=True, exist_ok=True)
    name = safe_name(final_url, fallback)
    (folder / name).write_bytes(body)
    return {
        "file": f"{folder.name}/{name}",
        "url": url,
        "bytes": len(body),
        "content_type": content_type.split(";")[0].strip(),
    }


# -------------------------------------------------------------------------- main


def clean_family_name(name):
    """Build tools mangle font names: Next.js ships `__Plus_Jakarta_Sans_a11773`.
    A brand kit has to say "Plus Jakarta Sans" or the client cannot go buy it."""
    name = name.strip().strip("'\"")
    name = re.sub(r"^_+", "", name)
    name = re.sub(r"_[0-9a-f]{6,}$", "", name)
    name = re.sub(r"_(Fallback)$", r" \1", name)
    return name.replace("_", " ").strip() or name


def dedupe_faces(faces):
    """One entry per family. A site declares @font-face once per weight, so a
    raw count says "21 tipografias" about a site that uses two."""
    by_family = {}
    for face in faces:
        family = clean_family_name(face["family"])
        key = family.lower()
        entry = by_family.setdefault(key, {"family": family, "weights": 0, "sources": []})
        entry["weights"] += 1
        for source in face["sources"]:
            if source not in entry["sources"]:
                entry["sources"].append(source)
    return list(by_family.values())


def build_gaps(kit):
    """What a scan structurally cannot know. See references/anatomy.md."""
    gaps = []
    if len(kit["logo"]["files"]) != 1:
        gaps.append("logo.principal — cual de los archivos es el logo oficial, y si hay version para fondo oscuro")
    gaps.append("logo.uso — aire minimo alrededor y tamanio minimo")
    gaps.append("logo.usos_indebidos — que no se hace nunca con la marca")
    gaps.append("imagenes.estilo — fotos reales, ilustracion o producto; y que NO va")
    gaps.append("voz.tono — de vos o de usted, que tono, y tres palabras que la marca no usa nunca")
    # Las referencias son lo que mas mueve el resultado de post-image: el estilo
    # se muestra, no se describe. Un kit sin referencias produce piezas correctas
    # y desconocidas entre si.
    gaps.append("referencias — 2 o 3 posteos que le gusten, para guardar en brand/referencias/ "
                "(el estilo se muestra, no se describe)")
    if not kit["identity"]["tagline"]:
        gaps.append("identidad.bajada — la frase que explica a que se dedica")
    return gaps


def main():
    parser = argparse.ArgumentParser(description="Scan a website and build the raw brand kit facts.")
    parser.add_argument("--url", required=True, help="the brand's own website")
    parser.add_argument("--out", default=os.environ.get("BRAND_DIR", "/opt/data/workspace/brand"))
    parser.add_argument("--no-download", action="store_true", help="record asset URLs without saving files")
    args = parser.parse_args()

    url = args.url if args.url.lower().startswith(("http://", "https://")) else "https://" + args.url
    out = Path(args.out)

    try:
        html, final_url = fetch_text(url)
    except (urllib.error.URLError, ValueError, OSError, TimeoutError) as error:
        print(json.dumps({
            "ok": False,
            "error": f"could not read {url}: {error}",
            "hint": "check the address, or build the kit by hand with what the client sends you",
        }, ensure_ascii=False))
        return 1

    sheets, sheet_urls = collect_stylesheets(html, final_url)
    variables, colors, raw_faces, stacks = parse_css(sheets)
    faces = dedupe_faces(raw_faces)
    stacks = [[clean_family_name(f) for f in stack] for stack in stacks]
    roles, why = infer_roles(variables, colors)

    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    kit = {
        "schema": SCHEMA_VERSION,
        "identity": {
            "name": meta_content(html, "og:site_name", "application-name") or (title.group(1).strip() if title else ""),
            "tagline": meta_content(html, "og:description", "description"),
            "url": final_url,
            "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        },
        "colors": {
            "roles": {role: roles[role] for role in ROLE_ORDER if role in roles},
            "why": why,
            "palette": [
                {"hex": color, "count": data["count"], "chroma": chroma(color),
                 "used_on": sorted(data["props"], key=lambda p: -data["props"][p])[:3]}
                for color, data in sorted(colors.items(), key=lambda kv: -kv[1]["count"])[:14]
            ],
            "declared_variables": variables,
        },
        "typography": {
            "faces": faces,
            "stacks": [s for i, s in enumerate(stacks) if s not in stacks[:i]][:8],
            "heading": stacks[0] if stacks else [],
            "body": next((s for s in stacks[1:] if s != (stacks[0] if stacks else None)), stacks[0] if stacks else []),
        },
        "logo": {"files": [], "candidates": find_logo_candidates(html, final_url)},
        "accessibility": {"pairs": []},
        "sources": {"page": final_url, "stylesheets": sheet_urls[:MAX_STYLESHEETS]},
        "gaps": [],
    }

    text_color = kit["colors"]["roles"].get("text")
    background = kit["colors"]["roles"].get("background")
    primary = kit["colors"]["roles"].get("primary")
    # The last two answer the question a designer actually asks: what colour of
    # text goes on top of a brand-coloured button.
    for label, fg, bg in (
        ("texto sobre fondo", text_color, background),
        ("primario sobre fondo", primary, background),
        ("blanco sobre primario", "#ffffff", primary),
        ("negro sobre primario", "#000000", primary),
    ):
        if fg and bg and fg != bg:
            ratio = contrast_ratio(fg, bg)
            kit["accessibility"]["pairs"].append({
                "pair": label, "fg": fg, "bg": bg, "ratio": ratio,
                "aa_normal": ratio >= 4.5, "aa_large": ratio >= 3.0, "aaa_normal": ratio >= 7.0,
            })

    if not args.no_download:
        for candidate in kit["logo"]["candidates"][:6]:
            record = download(candidate["url"], out / "logos", "logo")
            if record:
                record["kind"] = candidate["kind"]
                kit["logo"]["files"].append(record)
        for face in faces[:6]:
            for source in face["sources"]:
                if source["format"] and source["format"].lower() not in ("woff2", "woff"):
                    continue
                record = download(urllib.parse.urljoin(final_url, source["url"]), out / "fonts", "font")
                if record:
                    record["family"] = face["family"]
                    kit.setdefault("typography", {}).setdefault("files", []).append(record)
                    break

    kit["gaps"] = build_gaps(kit)

    out.mkdir(parents=True, exist_ok=True)
    (out / "brand.json").write_text(json.dumps(kit, ensure_ascii=False, indent=2), "utf-8")

    print(json.dumps({
        "ok": True,
        "brand_json": str(out / "brand.json"),
        "colors_found": len(kit["colors"]["palette"]),
        "roles": kit["colors"]["roles"],
        "fonts_found": len(faces),
        "logos_saved": len(kit["logo"]["files"]),
        "contrast_failures": [p["pair"] for p in kit["accessibility"]["pairs"] if not p["aa_normal"]],
        "gaps": kit["gaps"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
