"""The pages of the client's website, found by code.

MEASURED 2026-09-23, on our own agent: the researcher read tuagente.uy's home
page and nothing else, with «hasta ocho páginas» in its instructions. Part of
it is the model; most of it is that `web_fetch` drops `nav`, `header` and
`footer` before converting — on purpose, it is what keeps a page readable — and
those are exactly where a site lists its other pages. The home it read had no
way out.

So the map is code's: the site's `sitemap.xml` when it has one, and otherwise
every same-site link in the home page's RAW html, menus included. It goes into
the researcher's task, and `save_draft` hands it back when the draft names too
few of those pages (`business_draft.py`).

THE SAME SSRF-SAFE DOWNLOAD `web_fetch` USES (`engine/core/tools/web.py`): no
private or loopback address, whatever a sitemap says.
"""

import re
from urllib.parse import urljoin, urlparse

import httpx2
from pydantic_ai._ssrf import safe_download

TIMEOUT = 20
MAX_PAGES = 60
LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)
HREF = re.compile(r"""href\s*=\s*["']([^"'#]+)""", re.I)
NOT_A_PAGE = re.compile(
    r"\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|txt|zip|mp4|mp3|woff2?|ttf)$", re.I
)


def host(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def canonical(url: str) -> str:
    """One spelling per page: no query, no fragment, no trailing slash."""
    p = urlparse(url)
    path = p.path.rstrip("/") or "/"
    return f"{p.scheme}://{p.netloc.lower()}{path}"


async def get(url: str, accept: str) -> str | None:
    try:
        r = await safe_download(url, allow_local=False, timeout=TIMEOUT,
                                headers={"Accept": accept}, max_bytes=5 * 1024 * 1024)
    except (ValueError, httpx2.HTTPStatusError, httpx2.RequestError):
        return None
    return r.text


def keep(found: list[str], site: str) -> list[str]:
    out: list[str] = []
    for url in found:
        p = urlparse(url)
        if p.scheme not in ("http", "https") or host(url) != site or NOT_A_PAGE.search(p.path):
            continue
        c = canonical(url)
        if c not in out:
            out.append(c)
    return out[:MAX_PAGES]


async def pages(url: str) -> list[str]:
    """The site's pages, the home first. Just the home when nothing answers."""
    site = host(url)
    root = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    listed: list[str] = []
    sitemap = await get(root + "/sitemap.xml", "application/xml, text/xml")
    if sitemap:
        listed = LOC.findall(sitemap)
    if not listed:
        home = await get(url, "text/html")
        if home:
            listed = [urljoin(url, h.strip()) for h in HREF.findall(home)]
    return keep([canonical(url)] + listed, site)
