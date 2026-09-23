"""The pages of the client's website, found by code.

MEASURED 2026-09-23, on our own agent: the researcher read tuagente.uy's home
page and nothing else, with «hasta ocho páginas» in its instructions. Part of
it is the model; most of it is that `web_fetch` drops `nav`, `header` and
`footer` before converting — on purpose, it is what keeps a page readable — and
those are exactly where a site lists its other pages. The home it read had no
way out.

So the map is code's: the site's `sitemap.xml` AND every same-site link in the
home page's RAW html, menus included. It goes into the researcher's task, and
`save_draft` hands it back when the draft names too few of those pages
(`business_draft.py`).

A SITEMAP CAN BE AN INDEX OF SITEMAPS, and this read only one level. Measured
on QA's bike shop (aquabike.uy, a Wix site, 2026-09-23): its `sitemap.xml` is a
`<sitemapindex>` whose one `<loc>` is `pages-sitemap.xml`; that `.xml` was
dropped as "not a page", the list came out as the home alone, and the draft
called the three maintenance plans' details placeholders — they were on
`/mantenimiento-simple` and its two siblings, which nobody told the researcher
existed. The child sitemaps are read now, and the home's links are added to
the sitemap's instead of only standing in for it: a sitemap is whatever the
site builder remembered to put there, the menu is what the visitor sees.

THE SAME SSRF-SAFE DOWNLOAD `web_fetch` USES (`engine/core/tools/web.py`): no
private or loopback address, whatever a sitemap says.
"""

import re
from urllib.parse import urljoin, urlparse

import httpx2
from pydantic_ai._ssrf import safe_download

TIMEOUT = 20
MAX_PAGES = 60
# Child sitemaps read out of an index. A shop's index splits products,
# categories and posts into several; the pages that tell the business come
# first on every builder we have seen, and the rest is past MAX_PAGES anyway.
MAX_SITEMAPS = 5
INDEX = re.compile(r"<sitemapindex", re.I)
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


async def sitemap(root: str) -> list[str]:
    """Every `<loc>` of the site's sitemap, one level of index followed."""
    xml = await get(root + "/sitemap.xml", "application/xml, text/xml")
    if not xml:
        return []
    if not INDEX.search(xml):
        return LOC.findall(xml)
    listed: list[str] = []
    for child in LOC.findall(xml)[:MAX_SITEMAPS]:
        listed += LOC.findall(await get(child, "application/xml, text/xml") or "")
    return listed


async def pages(url: str) -> list[str]:
    """The site's pages, the home first. Just the home when nothing answers."""
    site = host(url)
    root = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    listed = await sitemap(root)
    home = await get(url, "text/html")
    if home:
        listed += [urljoin(url, h.strip()) for h in HREF.findall(home)]
    return keep([canonical(url)] + listed, site)
