"""The business plugin: the agent starts knowing the business it works for, and
the owner sees and corrects what it knows in the portal's «Marca» tab.

- `researcher.py` — the sub-agent that reads the client's site and what is
  public about the business, and `researcher.md`, how it does it.
- `business_draft.py` — the fixed shape of `negocio/borrador.md`: the
  researcher's `save_draft`, which writes it whole and keeps the sections the
  owner confirmed, the face's `correct_draft`, which rewrites one section with
  what the owner said, and the confirmations themselves.
- `business_watch.py` — runs the researcher: on its own, once per website the
  owner leaves at onboarding, or when she asks from «Marca». One at a time.
- `business_context.py` — the sections, the owner's notes
  (`negocio/notas.md`) and her files (`negocio/archivos/`), as the tab reads
  them and as the block the face gets in its instructions on every run.
- `business_routes.py` — what the tab calls, below.
- `instructions.md` — what the face does with that block, and when it hands
  the research back to the researcher.

THE «MARCA» CONTRACT. Every time is epoch SECONDS; an error is an
HTTPException with a Spanish sentence, served as `{error: {message}}`.

    GET    /portal/business
        {exists, researched_at, sources: [url], website, researching,
         sections: [{key, heading, text, confirmed, confirmed_at}],
         questions: [str], notes, files: [{name, path, size, uploaded_at}]}
        `sections` are the eight confirmable ones in the draft's order
        (summary, offer, customers, prices, where_and_when, channels, voice,
        edge) and empty while `exists` is false; `text` is the section's
        markdown without its heading. `path` is workspace-relative, for the
        portal's file viewer. `website` is the one she left, else the first
        page the last research read, else null.
    PUT    /portal/business/sections/{key}       {text} -> {ok, section}
        Her version, so it is confirmed. 404 unknown key or no draft yet, 400
        empty text.
    POST   /portal/business/sections/{key}/confirm -> {ok, section}
    PUT    /portal/business/notes                {text} -> {ok}
    POST   /portal/business/files                {name, content_b64} -> {ok, file}
        The same name replaces the file. 400 a name that is not one.
    DELETE /portal/business/files/{name}         -> {ok}; 404 when missing
    POST   /portal/business/research             {website?} -> {ok}
        Starts the researcher in the background; 409 while one is running, 400
        with no website known and none given. It ends in a
        `business.researched` event, which `/portal/changes` reports.

The tab refetches on the kinds `business.researched` and `business.corrected`
(the face correcting a section from the chat); the face delegating a research
ends in `delegation.finished`.
"""

import business_context
import business_draft
import business_routes
import business_watch
import researcher


def register(engine) -> None:
    engine.subagent(researcher.build(engine), label=researcher.LABEL)
    engine.toolset(business_draft.corrections())
    engine.ticker(business_watch.TICKER, business_watch.look, every=business_watch.EVERY)
    engine.capability(business_context.Context())
    engine.router(business_routes.router)
    engine.module("business", True)
