# THE WHATSAPP BRIDGE (`whatsapp-bridge/`), built here and copied into the
# engine's image: a Go binary over whatsmeow. It is in every image and runs only
# where the `whatsapp` plugin is enabled (`entrypoint.sh`). CGO because
# whatsmeow's store is SQLite through mattn/go-sqlite3; trixie on both sides so
# the binary links against the same glibc it runs on.
FROM golang:1.26-trixie AS bridge
WORKDIR /src
COPY whatsapp-bridge/go.mod whatsapp-bridge/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY whatsapp-bridge/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /whatsapp-bridge .

FROM python:3.12-slim

WORKDIR /app

# The pip cache is a build mount, so the wheels never land in a layer and a
# code change does not re-download the world.
COPY pyproject.toml ./
COPY core ./core
COPY server ./server
RUN --mount=type=cache,target=/root/.cache/pip pip install .

COPY --from=bridge /whatsapp-bridge /usr/local/bin/whatsapp-bridge
COPY entrypoint.sh /usr/local/bin/entrypoint

# uid/gid 10000: the same numbers the workspace and state bind mounts are
# chowned to on the host.
RUN groupadd -g 10000 core && useradd -u 10000 -g 10000 -M -d /app core
USER 10000:10000

EXPOSE 8643
# `--http h11` is load-bearing (it is in `entrypoint.sh`): uvicorn's default
# httptools writer lowercases every response header name, and portal-check
# reads `Access-Control-Allow-Origin` out of a case-sensitive dict. h11 writes
# the header names as the app spells them. See `server/app.py`'s Cors.
CMD ["entrypoint"]
