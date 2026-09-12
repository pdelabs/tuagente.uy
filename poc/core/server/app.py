"""One FastAPI app serving both of the portal's bases.

The portal has two: `endpoint` (the gateway, `/api/*`) and `adapter`
(`/portal/*`). The compose publishes this one container on 8642 and 8643 so
the magic link can point both at it.
"""

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from core import config

# Imported for the side effect, which is the registration itself: `compaction`
# and `turn_usage` append their capabilities to `core.agent.CAPABILITIES` and
# `promises_hook` its transform to `core.session.BEFORE_PERSIST`, all at import
# time, before the first turn builds the agent.
from core import compaction, promises_hook, turn_usage  # noqa: F401

# The gated toolset registers itself into `core.agent.EXTRA_TOOLSETS` on import.
from core.tools import sensitive  # noqa: F401

from . import approvals, extra, gateway, portal

ALLOW_METHODS = b"GET, POST, PATCH, DELETE, OPTIONS"
ALLOW_HEADERS = b"Authorization, Content-Type"


def canonical(name: bytes) -> bytes:
    return b"-".join(part[:1].upper() + part[1:] for part in name.split(b"-"))


class CanonicalHeaders:
    """Writes response header names as `Content-Type`, not `content-type`.

    Header names are case-insensitive and every browser agrees, but
    `hermes-kit/tools/portal-check.py` reads them out of `dict(res.headers)`
    — the case that came off the wire, verbatim. Starlette spells every header
    it writes in lowercase, so against this engine the check read an empty
    `Content-Type` and no `Access-Control-Allow-Origin` and failed five checks
    that were pure artifact. The kit's own adapter capitalizes them, so this
    is the spelling every tool written against it expects.

    Outermost middleware on purpose: it is the last thing to touch the
    headers. It only works because the container runs uvicorn with
    `--http h11` (see the Dockerfile): the default httptools writer lowercases
    every name on its way out.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def capitalized(message):
            if message["type"] == "http.response.start":
                message["headers"] = [(canonical(k), v) for k, v in message["headers"]]
            await send(message)

        await self.app(scope, receive, capitalized)


class Cors:
    """Reflects the origin, on the answer AND on the preflight."""

    def __init__(self, app, origins: list[str]):
        self.app = app
        self.origins = origins

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        origin = headers.get(b"origin", b"").decode()
        if origin not in self.origins:
            await self.app(scope, receive, send)
            return
        cors = [(b"Access-Control-Allow-Origin", origin.encode()), (b"Vary", b"Origin")]
        if scope["method"] == "OPTIONS" and b"access-control-request-method" in headers:
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": cors + [
                    (b"Access-Control-Allow-Methods", ALLOW_METHODS),
                    (b"Access-Control-Allow-Headers", ALLOW_HEADERS),
                    (b"Access-Control-Max-Age", b"600"),
                    (b"Content-Length", b"0"),
                ],
            })
            await send({"type": "http.response.body", "body": b""})
            return

        async def with_cors(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message["headers"]) + cors
            await send(message)

        await self.app(scope, receive, with_cors)


def require_key(authorization: str = Header(default="")):
    if authorization != f"Bearer {config.API_KEY}":
        raise HTTPException(401, "the client's key is missing or is not this agent's")


app = FastAPI(title="tuagente core", docs_url=None, redoc_url=None)
app.add_middleware(Cors, origins=config.CORS_ORIGINS)
# Added last, so it wraps everything and canonicalizes the CORS headers too.
app.add_middleware(CanonicalHeaders)

app.include_router(gateway.router, dependencies=[Depends(require_key)])
app.include_router(portal.router, dependencies=[Depends(require_key)])
app.include_router(approvals.router, dependencies=[Depends(require_key)])
app.include_router(extra.router, dependencies=[Depends(require_key)])


@app.exception_handler(StarletteHTTPException)
async def as_portal_error(request, exc: StarletteHTTPException):
    """`{error: {message}}` — the shape `lib/agent.ts` reads a failure from."""
    return JSONResponse({"error": {"message": exc.detail}}, status_code=exc.status_code)


@app.api_route("/portal/{rest:path}", methods=["GET", "POST", "PATCH", "DELETE"])
def module_absent(rest: str):
    """The portal reads a 404 as "this agent does not have that module"; a 500
    it reads as an outage, so an unknown path has to land here."""
    return JSONResponse(
        {"error": {"message": f"this agent has no /portal/{rest}"}}, status_code=404
    )
