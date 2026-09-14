FROM python:3.12-slim

WORKDIR /app

# The pip cache is a build mount, so the wheels never land in a layer and a
# code change does not re-download the world.
COPY pyproject.toml ./
COPY core ./core
COPY server ./server
RUN --mount=type=cache,target=/root/.cache/pip pip install .

# uid/gid 10000: the same numbers the workspace and state bind mounts are
# chowned to on the host.
RUN groupadd -g 10000 core && useradd -u 10000 -g 10000 -M -d /app core
USER 10000:10000

EXPOSE 8643
# `--http h11` is load-bearing: uvicorn's default httptools writer lowercases
# every response header name, and portal-check reads
# `Access-Control-Allow-Origin` out of a case-sensitive dict. h11 writes the
# header names as the app spells them. See `server/app.py`'s Cors.
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8643", "--http", "h11"]
