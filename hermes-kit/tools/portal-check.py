#!/usr/bin/env python3
"""Conformance check: is this Hermes agent ready for the portal?

Runs against an already-deployed agent and verifies the whole contract,
without writing anything. Used to onboard a new client with no surprises.

    python3 tools/portal-check.py --key <API_SERVER_KEY> \
        [--adapter http://localhost:8643] [--endpoint http://localhost:8642] \
        [--origin http://localhost:8090] [--attempts 3]

EVERY CHECK RUNS SEVERAL TIMES, and it is not paranoia: on 12/8/2026, in the
lab, `GET /api/sessions` started returning 500 intermittently -- 14 out of 20
requests -- and this check, which hit it once, came back green 3 out of every
10 runs. A check that is green 30% of the time is worse than not having one:
it certifies exactly what it did not look at. Now an endpoint that fails even
once is a FAILURE, and the message states the rate.

Exit 0 = compliant. Exit 1 = there are failures (listed at the end).
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

OK, FAIL, WARN = "OK  ", "FAIL ", "warn "
results = []
ATTEMPTS = 3


def check(name, fn, required=True):
    """Runs one check N times and records the result.

    N times and not once: see the note above. The rule is strict on purpose --
    an endpoint that works 2 out of 3 times is NOT ready for the portal,
    because on the third the client sees "Could not reach your agent" and goes
    looking for the bug in the portal, which has nothing to do with it.

    The attempts run back to back with no wait: the failure mode we are
    looking for shows up under consecutive requests, not after a pause. With
    the agent down this does not run forever: the manifest check is first,
    and if it does not answer, main() cuts it short right there.
    """
    detail, failures = "", []
    for _ in range(ATTEMPTS):
        try:
            detail = fn() or detail
        except Exception as exc:  # noqa: BLE001 — we want to report any failure
            # 300 and not 120: cutting it shorter used to eat exactly the
            # useful part -- the command to fix it goes at the end of the
            # message -- and a failure that states the symptom without saying
            # what to do sends you guessing.
            failures.append(str(exc)[:300])
    if not failures:
        results.append((OK, name, detail))
        return True
    if len(failures) < ATTEMPTS:
        # The worst thing that can happen is this passing as a stumble and
        # coming back green: the rate and the first error are stated, which is
        # what's needed to tell whether it's the network or the agent.
        rate = f"INTERMITTENT — failed {len(failures)} of {ATTEMPTS} attempts"
    else:
        rate = f"failed all {ATTEMPTS} attempts"
    results.append((FAIL if required else WARN, name, f"{rate}: {failures[0]}"))
    return False


def http(url, key=None, origin=None, method="GET", expect=200):
    req = urllib.request.Request(url, method=method)
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    if origin:
        req.add_header("Origin", origin)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            body, status, hdrs = res.read(), res.status, dict(res.headers)
    except urllib.error.HTTPError as exc:
        body, status, hdrs = exc.read(), exc.code, dict(exc.headers)
    if status != expect:
        raise AssertionError(f"expected {expect}, got {status}")
    return body, hdrs


def jget(url, key, origin=None):
    body, hdrs = http(url, key, origin)
    return json.loads(body), hdrs


def main():
    global ATTEMPTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True)
    ap.add_argument("--adapter", default="http://localhost:8643")
    ap.add_argument("--endpoint", default="http://localhost:8642")
    ap.add_argument("--origin", default="http://localhost:8090")
    ap.add_argument(
        "--delivery", action="store_true",
        help="on top of the contract, requires the agent to be AT ZERO: the "
             "check for the last step of an onboarding, before sending the link")
    ap.add_argument(
        "--attempts", type=int, default=ATTEMPTS, metavar="N",
        help=f"how many times EACH check runs (default {ATTEMPTS}). Raise it "
             "when you suspect something intermittent: with 10 you see the "
             "real rate without guessing")
    args = ap.parse_args()
    if args.attempts < 1:
        ap.error("--attempts has to be 1 or more")
    ATTEMPTS = args.attempts
    A, E, K, O = args.adapter.rstrip("/"), args.endpoint.rstrip("/"), args.key, args.origin

    manifest = {}

    def _manifest():
        nonlocal manifest
        manifest, _ = jget(f"{A}/portal/manifest", K)
        missing = [k for k in ("agent", "portal_plugin", "modules") if k not in manifest]
        if missing:
            raise AssertionError(f"manifest is missing keys: {missing}")
        if not str(manifest["agent"]).strip():
            raise AssertionError("the agent has no name (AGENT_NAME)")
        return f"{manifest['agent']} · {manifest['portal_plugin']}"

    check("Manifest", _manifest)
    if not manifest:
        print("Could not read the manifest: without it, the portal will not start.")
        return 1
    mods = manifest.get("modules", {})

    # Auth and CORS: a portal without this does not work in the browser even
    # if curl behaves fine.
    check("Rejects without credentials", lambda: (
        http(f"{A}/portal/manifest", None, expect=401), "401")[1])
    check("Adapter CORS", lambda: (
        jget(f"{A}/portal/manifest", K, O)[1].get("Access-Control-Allow-Origin") == O
        or (_ for _ in ()).throw(AssertionError(f"does not reflect origin {O}")),
        "reflects the origin")[1])
    check("Gateway CORS", lambda: (
        http(f"{E}/api/jobs?include_disabled=true", K, O)[1].get("Access-Control-Allow-Origin") == O
        or (_ for _ in ()).throw(AssertionError(f"does not reflect origin {O}")),
        "reflects the origin")[1])

    # THE TWO LOOPBACK SPELLINGS. To the browser `http://localhost:8090` and
    # `http://127.0.0.1:8090` are DIFFERENT origins: if the list only carries
    # one, this check passes with whichever you gave it and the client sees
    # "Could not reach your agent" opening the other one. curl never catches
    # this -- it never sends `Origin` -- so it's the classic "works via curl,
    # doesn't work in the browser."
    # Only applies when the origin is loopback: against a real portal
    # (app.tuagente.uy) there is no twin to check and this does not run.
    twin = None
    if "//localhost:" in O:
        twin = O.replace("//localhost:", "//127.0.0.1:")
    elif "//127.0.0.1:" in O:
        twin = O.replace("//127.0.0.1:", "//localhost:")
    if twin:
        def _twin(url, who):
            def fn():
                got = http(url, K, twin)[1].get("Access-Control-Allow-Origin")
                if got != twin:
                    raise AssertionError(
                        f"accepts {O} but not {twin} — add BOTH to "
                        f"{who} in the compose and restart")
                return f"also reflects {twin}"
            return fn
        check("Adapter CORS (the other loopback spelling)",
              _twin(f"{A}/portal/manifest", "PORTAL_CORS_ORIGINS"))
        check("Gateway CORS (the other loopback spelling)",
              _twin(f"{E}/api/jobs?include_disabled=true", "API_SERVER_CORS_ORIGINS"))

    # Every declared module has to actually answer.
    def modcheck(name, url, validate):
        if not mods.get(name):
            results.append((WARN, f"Module {name}", "not declared — the tab does not show"))
            return
        check(f"Module {name}", lambda: validate(*jget(url, K)))

    modcheck("kanban", f"{A}/portal/tickets",
             lambda d, h: f"{len(d['tickets'])} tickets")
    modcheck("approvals", f"{A}/portal/approvals",
             lambda d, h: f"{len(d['approvals'])} pending")
    modcheck("artifacts", f"{A}/portal/artifacts",
             lambda d, h: f"{len(d['artifacts'])} artifacts")
    def _roles_ok(d, h):
        # The team is the product now: a declared roles module must serve the
        # offer, and every hired role must be reachable through the multiplex
        # with its own key -- which only the adapter can verify, so here we at
        # least assert the roster's shape and that hired roles carry identity.
        if not d.get("available"):
            raise AssertionError("declared but available=false")
        roles = d.get("roles") or []
        if not roles:
            raise AssertionError("the offer catalog is empty")
        hired = [r for r in roles if r.get("hired")]
        faceless = [r["id"] for r in roles if not (r.get("name") and r.get("look"))]
        if faceless:
            raise AssertionError(f"roles with no identity (name/look): {faceless}")
        pending = [r["id"] for r in roles if r.get("request") and r not in hired]
        extra = f", {len(pending)} requested" if pending else ""
        return f"{len(roles)} on offer, {len(hired)} hired{extra}"
    modcheck("roles", f"{A}/portal/roles", _roles_ok)
    modcheck("activity", f"{A}/portal/activity",
             lambda d, h: f"{len(d['events'])} events")
    def _usage_ok(d, h):
        # Declared and broken is NOT "it works": if the manifest promises the
        # module, the number has to show up. And a missing total is stated,
        # not invented as a 0.
        if not d.get("available"):
            raise AssertionError("declared but the provider is not answering: " + str(d.get("reason")))
        total = d.get("total_usd")
        return ("USD — (the provider did not report the total)" if total is None
                else f"USD {total:.4f} charged to this key")
    modcheck("usage", f"{A}/portal/usage", _usage_ok)
    modcheck("crons", f"{E}/api/jobs?include_disabled=true",
             lambda d, h: f"{len(d['jobs'])} jobs (includes paused)")

    # Files: on top of the listing, the content must NEVER be served as html.
    if mods.get("files"):
        def _files():
            data, _ = jget(f"{A}/portal/files", K)
            files = data["files"]
            if files:
                _, hdrs = http(f"{A}/portal/files/{files[0]['path']}", K)
                ctype = hdrs.get("Content-Type", "")
                if "text/plain" not in ctype:
                    raise AssertionError(f"serves files as {ctype!r}, has to be text/plain")
            return f"{len(files)} files"
        check("Module files", _files)
    else:
        results.append((WARN, "Module files", "not declared"))

    # Chat is the heart of it: if the session stream does not go through the
    # adapter, the browser discards it over CORS (the gateway does not send
    # the header).
    check("Chat proxy on the adapter", lambda: (
        http(f"{A}/portal/sessions/does-not-exist/chat/stream", K, method="POST", expect=400),
        "responds (validates the body)")[1], required=False)
    check("Agent sessions", lambda: (
        f"{len(jget(f'{E}/api/sessions', K)[0]['data'])} conversations"))

    # Workspace conventions that make the Files tab usable.
    def _deliverables():
        """On a brand-new agent this is not a symptom: it hasn't produced anything yet.

        The listing returns files, not folders, so an empty folder does not
        show up. This used to warn "does the agent have the deliverable
        skill?" on every onboarding, which is a false alarm and trains people
        to ignore warnings.
        """
        files = jget(f"{A}/portal/files", K)[0]["files"]
        if any(f["path"].startswith("entregables/") for f in files):
            return "entregables/ present"
        if not files:
            return "new agent: has not written anything yet (expected)"
        raise AssertionError(
            "there are files but none in entregables/ — is the agent using "
            "the deliverable skill, or picking its own paths?"
        )

    check("Deliverables convention", _deliverables, required=False)

    # --- the agent being delivered starts at zero ---
    #
    # This is not cosmetic: day one is when the client decides what this is.
    # If they open their portal and find a conversation of ours -- the
    # verification one -- the first thing they learn is that their agent
    # already came used. Verifying necessarily dirties it (the loop that
    # sells the product is talking to it, asking for an artifact, and
    # approving something), so what cannot depend on anyone's memory is
    # CLEANING IT UP afterward: this is what checks that it was done, with
    # the command right next to it.
    #
    # Only with --delivery: against a production agent, having conversations
    # is exactly what's expected.
    if args.delivery:
        def _at_zero():
            trace = []
            sessions = len(jget(f"{E}/api/sessions", K)[0]["data"])
            if sessions:
                trace.append(f"{sessions} conversation(s)")
            if mods.get("kanban"):
                n = len(jget(f"{A}/portal/tickets", K)[0]["tickets"])
                if n:
                    trace.append(f"{n} ticket(s) on the board")
            if mods.get("artifacts"):
                n = len(jget(f"{A}/portal/artifacts", K)[0]["artifacts"])
                if n:
                    trace.append(f"{n} artifact(s)")
            if mods.get("files"):
                n = len(jget(f"{A}/portal/files", K)[0]["files"])
                if n:
                    trace.append(f"{n} file(s) in the workspace")
            # Spend LEFT OUT of this check, and not by oversight: since the
            # number comes from OpenRouter (`/portal/usage`), it is what the
            # KEY has had charged since it existed, and that cannot be reset
            # to zero. A just-verified agent would stay marked "used" forever
            # and the check would be impossible to pass. What DOES stay at
            # zero -- conversations, board, artifacts, files -- is enough for
            # what this guards: that the client does not find someone else's
            # work inside their portal on day one.
            if manifest.get("named"):
                trace.append("already named (the client would not see the onboarding)")
            if trace:
                raise AssertionError(
                    "the agent arrives with our fingerprint: " + " · ".join(trace)
                    + " — reset it to zero with  tools/reset-agent.sh --local "
                      "<path> --delivery  (or --delivery over ssh) and run this again")
            return "no conversations, no board, no files, and not named"

        check("Delivery: the agent is at zero", _at_zero)

    print(f"\nAgent: {manifest.get('agent')} — {manifest.get('portal_plugin')}\n")
    for status, name, detail in results:
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ""))
    failures = [r for r in results if r[0] == FAIL]
    warnings = [r for r in results if r[0] == WARN]
    times = "1 time" if ATTEMPTS == 1 else f"{ATTEMPTS} times"
    print(f"\n{len(results) - len(failures) - len(warnings)} ok · {len(warnings)} warnings · "
          f"{len(failures)} failures  (each check ran {times})")
    if failures:
        print("\nNot ready for the portal. Fix:")
        for _, name, detail in failures:
            print(f"  · {name}: {detail}")
        return 1
    print("\nConforms to the portal contract.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
