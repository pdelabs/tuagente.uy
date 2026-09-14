#!/usr/bin/env python3
"""Tests for `news-copy`'s `open_news_ticket.py` — the news item's ticket.

    python3 -m unittest test_open_news_ticket.py

THE MEASUREMENT THAT PUT THIS FILE HERE. `noticia-para-publicar` sells the
client two things on its card: a ticket per note, and the sí before anything is
published. Both were sentences in a SKILL.md. On the from-zero run the model
remembered them; on an independent re-run with a different URL it did not, and
the deliverable came out correct while the board got NOTHING — no ticket, no
approval, no trace (`docs/east-requirements.md` §5.5). The interview half of the
same plugin never had that failure, because `fetch_video.py` opens its ticket
from code with an idempotency key. This is the same supplier for the news half,
and these are the tests the interview one still does not have.

WHAT IS MOCKED AND WHY. `hermes kanban create` is the agent's real board; here
it is a dict that dedups by `--idempotency-key`, which is exactly what the CLI
promises ("If a non-archived task with this key exists, its id is returned
instead of creating a duplicate"). Mocking it is what lets a test ask the
question that matters — *the same note twice, how many cards?* — without a
board, and lets "the board refused" be a state we produce on purpose.

They live under `tools/` rather than next to the script because that is where
the kit's suite is discovered from (`python3 -m unittest discover -s
kit/tools`), and a test nobody runs is not a test. Same as
`test_create_flow.py`.
"""
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

KIT = Path(__file__).resolve().parent.parent
SKILL = KIT / "plugins" / "interview-production" / "skills" / "news-copy"


def load():
    spec = importlib.util.spec_from_file_location(
        "open_news_ticket", SKILL / "open_news_ticket.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


news = load()

ARTICLE = "https://www.elmedio.uy/2026/08/30/condenaron-a-doce-personas/"


class Board:
    """A kanban that dedups on the key, and counts the cards it really opened."""

    def __init__(self, returncode=0, stderr="", stdout=None):
        self.by_key = {}
        self.calls = []
        self.returncode, self.stderr, self.stdout = returncode, stderr, stdout

    def run(self, argv, **kwargs):
        self.calls.append(argv)
        if self.returncode or self.stdout is not None:
            return SimpleNamespace(returncode=self.returncode,
                                   stdout=self.stdout or "", stderr=self.stderr)
        key = next(a.split("=", 1)[1] for a in argv
                   if a.startswith("--idempotency-key="))
        title = argv[-1]
        if key not in self.by_key:
            self.by_key[key] = (f"t_{len(self.by_key) + 1:08x}", title)
        ticket, first_title = self.by_key[key]
        return SimpleNamespace(
            returncode=0, stderr="",
            stdout=json.dumps({"id": ticket, "title": first_title,
                               "status": "todo", "assignee": None}))

    @property
    def cards(self):
        return len(self.by_key)


def call(*argv, board=None, stdin="", serving="", binary="/opt/hermes/bin/hermes"):
    """`main()` with a scripted CLI. Returns (board, exit code, payload)."""
    board = board if board is not None else Board()
    env = {"HERMES_KANBAN_TASK": serving} if serving else {}
    out = io.StringIO()
    with mock.patch.object(news.sys, "argv", ["open_news_ticket.py", *argv]), \
            mock.patch.object(news.sys, "stdin", io.StringIO(stdin)), \
            mock.patch.object(news, "resolve", lambda *a: binary), \
            mock.patch.object(news.subprocess, "run", board.run), \
            mock.patch.dict(news.os.environ, env, clear=True), \
            redirect_stdout(out):
        code = news.main()
    return board, code, json.loads(out.getvalue())


class TheSameNoteIsOneCard(unittest.TestCase):
    """The whole reason the key is computed and not typed."""

    def test_the_same_link_twice_opens_one_ticket(self):
        board, code, first = call("--url", ARTICLE)
        self.assertEqual(code, 0)
        _, _, again = call("--url", ARTICLE, board=board)
        self.assertEqual(board.cards, 1, "a second card for the same note")
        self.assertEqual(again["ticket"], first["ticket"])
        self.assertEqual(len(board.calls), 2, "the script did ask twice")

    def test_the_same_note_as_it_travels_is_still_one_ticket(self):
        """Every one of these is how the SAME url arrives in a real chat."""
        board, _, first = call("--url", ARTICLE)
        for variant in (
                "http://www.elmedio.uy/2026/08/30/condenaron-a-doce-personas/",
                "https://elmedio.uy/2026/08/30/condenaron-a-doce-personas",
                "https://ELMEDIO.uy/2026/08/30/condenaron-a-doce-personas/",
                ARTICLE + "?utm_source=whatsapp&utm_medium=share",
                ARTICLE + "#comentarios",
                ARTICLE + "?fbclid=IwAR123",
                "  " + ARTICLE + "  ",
        ):
            _, _, same = call("--url", variant, board=board)
            self.assertEqual(same["ticket"], first["ticket"], variant)
        self.assertEqual(board.cards, 1)

    def test_the_client_tells_them_apart_so_the_key_does_too(self):
        """Two notes must never share a card: that is the expensive direction."""
        board, _, one = call("--url", ARTICLE)
        for other in (
                "https://elmedio.uy/2026/08/30/otra-nota-distinta/",
                "https://otromedio.uy/2026/08/30/condenaron-a-doce-personas/",
                # A portal that routes by id: the parameter IS the note.
                "https://elmedio.uy/nota?id=4821",
                "https://elmedio.uy/nota?id=4822",
                # Case in a path is a different resource on any real server.
                "https://elmedio.uy/2026/08/30/Condenaron-a-doce-personas",
        ):
            _, _, another = call("--url", other, board=board)
            self.assertNotEqual(another["ticket"], one["ticket"], other)

    def test_the_order_of_what_is_kept_does_not_matter(self):
        self.assertEqual(news.normalize_url("https://elmedio.uy/n?b=2&a=1"),
                         news.normalize_url("https://elmedio.uy/n?a=1&b=2"))

    def test_the_normalized_url_is_reported_next_to_the_one_they_sent(self):
        """The client's link is not rewritten: only the key is computed on it."""
        _, _, payload = call("--url", ARTICLE + "?utm_source=whatsapp")
        self.assertEqual(payload["source"]["url"], ARTICLE + "?utm_source=whatsapp")
        self.assertEqual(payload["source"]["normalized_url"],
                         "https://elmedio.uy/2026/08/30/condenaron-a-doce-personas")
        self.assertTrue(payload["key"].startswith("news:elmedio.uy:"), payload["key"])


class TheCardItOpens(unittest.TestCase):
    """What `hermes kanban create` is actually asked for."""

    def argv(self, *extra):
        board, _, payload = call("--url", ARTICLE, *extra)
        return board.calls[0], payload

    def test_it_is_unassigned_on_purpose(self):
        """`fetch_video.py`'s reason, unchanged: the turn calling this is the
        one writing the note, and an assignee hands it to the dispatcher too."""
        argv, _ = self.argv()
        self.assertNotIn("--assignee", " ".join(argv))

    def test_it_asks_for_json_and_carries_the_key(self):
        argv, payload = self.argv()
        self.assertEqual(argv[1:4], ["kanban", "create", "--json"])
        self.assertIn(f"--idempotency-key={payload['key']}", argv)

    def test_the_title_is_the_words_the_agent_passed(self):
        argv, _ = self.argv("--about", "  condena  por   tráfico  ")
        self.assertEqual(argv[-1], "Noticia — condena por tráfico")

    def test_without_words_the_title_comes_off_the_slug(self):
        """The outlet already wrote a headline into its own path."""
        argv, _ = self.argv()
        self.assertEqual(argv[-1], "Noticia — Condenaron a doce personas")

    def test_a_path_with_no_slug_falls_back_to_something_true(self):
        """`/notas/4821` is a section and an id: neither names the note, and
        "Noticia — Notas" would read as if the agent knew something."""
        board, _, _ = call("--url", "https://elmedio.uy/notas/4821")
        self.assertEqual(board.calls[0][-1], "Noticia — elmedio.uy")

    def test_a_headline_in_about_does_not_become_the_card_name(self):
        argv, _ = self.argv("--about", "x" * 200)
        self.assertEqual(argv[-1], "Noticia — " + "x" * 60 + "…")

    def test_a_long_slug_is_cut_on_a_word_and_says_it_was_cut(self):
        """The first live run's card, 30/8: cutting at the character left
        «…cinco heridos que fuer» on the board."""
        board, _, _ = call("--url", "https://www.subrayado.com.uy/dispararon-un-auto"
                           "-una-casa-y-dejaron-cinco-heridos-que-fueron-derivados"
                           "-al-pasteur-n1016694")
        self.assertEqual(
            board.calls[0][-1],
            "Noticia — Dispararon un auto una casa y dejaron cinco heridos que…")

    def test_the_body_says_where_the_note_came_from(self):
        argv, _ = self.argv()
        body = next(a for a in argv if a.startswith("--body="))
        self.assertIn(ARTICLE, body)
        self.assertIn("aprobación", body)

    def test_what_it_hands_back_is_the_next_command_and_the_gate(self):
        _, _, payload = call("--url", ARTICLE)
        self.assertIn("/opt/kit/skills/deliverable/deliver.py", payload["next"])
        self.assertIn("--flow noticia-para-publicar", payload["next"])
        self.assertIn(payload["ticket"], payload["note"])
        self.assertIn("needs_input", payload["note"])

    def test_the_note_says_the_ticket_is_left_blocked_and_not_finished(self):
        """The failure of the FIRST live run with a ticket, 30/8: the turn
        commented the request, blocked the card for `needs_input` and then
        completed it in the same breath. A finished ticket is out of the
        Aprobaciones queue, so the sí it was waiting for can no longer be given
        — the gate had run and left nothing to press."""
        _, _, payload = call("--url", ARTICLE)
        self.assertIn("BLOQUEADO, no terminado", payload["note"])
        self.assertIn("cierra el sí", payload["note"])


class WhenThereIsNoTicketTheNoteIsNotWritten(unittest.TestCase):
    """The one place this script is FIRMER than `fetch_video.py`, on purpose.

    That one keeps going when the board refuses it: it already has the audio,
    and losing the download is a worse outcome than a missing card. Here the
    ticket IS the approval's only address, so carrying on is the exact failure
    the script was written for.
    """

    def refused(self, **board):
        board, code, payload = call("--url", ARTICLE, board=Board(**board))
        self.assertEqual(code, 2)
        self.assertFalse(payload["ok"])
        return payload

    def test_a_board_that_says_no_stops_the_work(self):
        payload = self.refused(returncode=1, stderr="database is locked")
        self.assertIn("database is locked", payload["error"])
        self.assertIn("NO se escribe", payload["error"])
        self.assertIn("Decíselo al cliente", payload["error"])
        # The key travels with the refusal: which note failed is
        # the one thing the agent cannot reconstruct afterwards.
        self.assertTrue(payload["key"].startswith("news:elmedio.uy:"))

    def test_an_answer_it_cannot_read_is_not_a_ticket(self):
        payload = self.refused(stdout="Something happened, probably fine\n")
        self.assertIn("no puedo leer como ticket", payload["error"])

    def test_no_cli_is_a_stop_and_not_a_traceback(self):
        _, code, payload = call("--url", ARTICLE, binary=None)
        self.assertEqual(code, 2)
        self.assertIn("CLI de Hermes", payload["error"])

    def test_something_that_is_not_a_link_never_reaches_the_board(self):
        board, code, payload = call("--url", "elmedio.uy/la-nota")
        self.assertEqual(code, 2)
        self.assertEqual(board.calls, [])
        self.assertIn("--file", payload["error"])

    def test_a_file_that_is_not_there_never_reaches_the_board(self):
        board, code, payload = call("--file", "/no/such/nota.pdf")
        self.assertEqual(code, 2)
        self.assertEqual(board.calls, [])
        self.assertIn("nota.pdf", payload["error"])

    def test_an_empty_paste_is_refused(self):
        board, code, payload = call("--text", stdin="   \n\n")
        self.assertEqual(code, 2)
        self.assertEqual(board.calls, [])


class InsideATicketAlready(unittest.TestCase):
    """Served by the dispatcher: a second card is what `approval` forbids."""

    def test_the_ticket_the_dispatcher_gave_is_the_one_used(self):
        board, code, payload = call("--url", ARTICLE, serving="t_315e5dab")
        self.assertEqual(code, 0)
        self.assertEqual(payload["ticket"], "t_315e5dab")
        self.assertEqual(payload["ticket_from"], "dispatcher")
        self.assertEqual(board.calls, [], "it opened a second card for the same note")


class MaterialThatIsNotALink(unittest.TestCase):
    """The other two entry paths the flow accepts, keyed on the material."""

    def file(self, name, content, board=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / name
        path.write_bytes(content)
        return call("--file", str(path), board=board)

    def test_the_same_file_renamed_is_the_same_note(self):
        board, _, first = self.file("nota.pdf", b"%PDF-1.4 la nota")
        _, _, again = self.file("nota-final.pdf", b"%PDF-1.4 la nota", board=board)
        self.assertEqual(again["ticket"], first["ticket"])
        self.assertEqual(board.cards, 1)

    def test_another_file_is_another_note(self):
        board, _, first = self.file("nota.pdf", b"%PDF-1.4 la nota")
        _, _, other = self.file("nota.pdf", b"%PDF-1.4 otra nota", board=board)
        self.assertNotEqual(other["ticket"], first["ticket"])

    def test_the_card_is_named_after_the_file_when_nobody_says_otherwise(self):
        board, _, _ = self.file("condena-maldonado.pdf", b"x")
        self.assertEqual(board.calls[0][-1], "Noticia — Condena maldonado")

    def test_the_same_text_pasted_twice_is_one_card(self):
        board, _, first = call("--text", stdin="Condenaron a doce personas.\nEl fallo salió hoy.")
        _, _, again = call("--text", board=board,
                           stdin="  Condenaron a doce personas.\n\n   El fallo salió hoy.  ")
        self.assertEqual(again["ticket"], first["ticket"])
        self.assertEqual(board.cards, 1)
        self.assertEqual(first["source"]["kind"], "text")

    def test_another_text_is_another_card(self):
        board, _, first = call("--text", stdin="Condenaron a doce personas.")
        _, _, other = call("--text", stdin="Condenaron a trece personas.", board=board)
        self.assertNotEqual(other["ticket"], first["ticket"])


class WhatTheClientWasPromisedHasASupplier(unittest.TestCase):
    """The gap this closes is between a SKILL.md sentence and code, so the
    sentence is part of the test: prose that stops naming the script is the
    failure coming back."""

    def skill(self):
        return (SKILL / "SKILL.md").read_text(encoding="utf-8")

    def test_the_skill_runs_the_script_where_the_agent_will_find_it(self):
        text = self.skill()
        self.assertIn("python3 /opt/kit/skills/news-copy/open_news_ticket.py", text)
        self.assertTrue((SKILL / "open_news_ticket.py").is_file(),
                        "the path the SKILL.md names is the delivered one: "
                        "kit-skills/<name>/ is this directory, flattened")

    def test_the_ticket_comes_before_the_deliverable_in_the_instructions(self):
        text = self.skill()
        self.assertLess(text.index("open_news_ticket.py"),
                        text.index("deliverable/deliver.py"))

    def test_the_approval_is_asked_for_in_the_ticket_the_script_opened(self):
        text = self.skill()
        self.assertIn("el ticket que te dio el paso 1", text)
        self.assertIn("needs_input", text)

    def test_the_skill_and_the_card_both_say_the_ticket_waits_blocked(self):
        self.assertIn("queda BLOQUEADO, no terminado", self.skill())
        flow = (KIT / "plugins" / "interview-production" / "flows"
                / "noticia-para-publicar" / "FLOW.md").read_text(encoding="utf-8")
        self.assertIn("no se termina antes", flow)

    def test_the_flow_card_still_promises_it_and_now_names_the_supplier(self):
        flow = (KIT / "plugins" / "interview-production" / "flows"
                / "noticia-para-publicar" / "FLOW.md").read_text(encoding="utf-8")
        self.assertIn("Abro el ticket de esa noticia", flow)
        self.assertIn("open_news_ticket.py", flow)


if __name__ == "__main__":
    unittest.main()
