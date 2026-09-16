# The inbox and the Instagram comments — plan

Written 2026-09-15, the day the first post went out. The posts end in
«escribinos», and today the answer lands in Luis' Gmail and in Instagram's
comment feed, where our own agent cannot see it. Two plugins fix that, and
one thing they share: **a lead has to land somewhere the client looks.**
The portal already has that screen, the board (`/app/pipeline`,
`/portal/tickets`), and the engine answers it empty. So the plan is three
pieces: the board rebuilt on the engine, the `mail` plugin, and the
`instagram` plugin. Each is sold on its own; Mr. Wobbles runs all three.

Same rules as `docs/own-agent-plan.md`: what is built for us is what a
client buys, nothing client-specific in the code, the format is the code's
and the words are the model's, every outward action is behind the gate.

## What it must prove (the gates)

| # | Gate | How it is verified |
|---|---|---|
| B1 | **A ticket exists, moves, and the board shows it.** A tool call creates a ticket; the Tablero tab lists it in the right column; the detail shows body, comments and outcome; moving it and commenting from the portal work; the agent's `update_ticket` moves it too. Portal contract unchanged. | `engine/tests/test_board.py` (no model) + `portal-check` with `kanban` declared. |
| M1 | **A mail becomes a ticket.** A message to the inbox is a ticket in «Nuevo» within one tick, with sender, subject, body, and the thread id. The same message never makes two tickets. A restart does not replay the inbox. | `engine/tests/test_mail.py` against a local IMAP/SMTP stub in the lab container; two ticks, one ticket. |
| M2 | **The reply waits for the ok, then goes out for real.** The flow run drafts the answer in the brand voice, calls `send_email`, the run pauses, the card shows the mail thread and the draft, approval sends it through SMTP as `info@`, the ticket moves to «Respondido», the thread is on the ticket. Rejection leaves the ticket in «Esperando» with the reason. | `test_mail_gate.sh` in the style of `test_flow_gate.sh`; the stub SMTP records the message. |
| M3 | **The «nunca» holds.** A mail asking for a price gets a draft that names the diagnóstico and its USD 200 and nothing else; a mail asking «¿cuándo pueden?» gets a draft that does not promise a date. Newsletters and notifications are discarded, not answered. | Three live runs on the lab, read by hand; the caption rules in the skill are what makes them pass. |
| I1 | **A comment becomes something.** New comments on our posts are read every tick; a question gets a reply through the gate, a lead («¿cómo hago?», «precio», «me interesa») becomes a ticket with the comment and the post, spam and «🔥» get nothing. A comment is never handled twice. | `test_instagram_comments.py` with `httpx.MockTransport`; one live tick on the own agent against a real comment Luis leaves. |
| I2 | **The creator reads before writing.** The daily flow's creator sees the last posts' reach and saves and the comments, and its report says what it took from them. | The delegation output of one real run names a number from insights. |
| G | **Nothing regressed.** Approval crash test, flow gate, delegation, post, fix, place, instagram publish, publish gate, kit unit tests, checks, `tsc`, `build`. | The suites. |

## Decisions

### The board is the engine's, small

- **`kit/plugins/kanban/core/`** gets a real surface: a `tickets` table in the engine's SQLite (`id, title, body, status, source, source_ref, created_at, updated_at, closed_at`), `ticket_comments`, and the routes the portal already types: `GET /portal/tickets`, `GET /portal/tickets/{id}` (detail with comments, events, outcome), `POST /portal/tickets` (the client's own request, status `ready`), `POST …/comment`, `POST …/status`. `config.MODULES["kanban"] = True` when the plugin loads. `engine/server/portal.py`'s empty `/portal/tickets` goes.
- **Statuses are the portal's five** (`app/app/lib` `BOARD_COLUMNS`): the plugin does not invent columns. Spanish labels stay in the portal.
- **Tools on the face:** `create_ticket(title, body, source?)`, `update_ticket(id, status?, comment?)`. Not gated: a ticket is internal. The approval card of a gated tool called from a ticket's run names the ticket (`asked_by` already reads the session; the ticket id travels in the session title, like the flow's name does).
- **`source` and `source_ref`** say where a ticket came from: `mail` + the IMAP message id, `instagram` + the comment id, `client` for one made in the portal. They are the dedupe key for the two plugins and the link the portal draws («Ver el mail», «Ver el comentario»).
- **Ticket events** are the events table filtered by `ticket_id` in the payload; no second timeline.

### The mail plugin

- **`kit/plugins/mail/`**, capability `inbox` (catalog row: «Que tu agente lea la casilla, arme la respuesta con tu voz y te la deje para aprobar»). Requires connection `email` (IMAP/SMTP, the catalog row that exists: `EMAIL_ADDRESS`, `EMAIL_PASSWORD`, `EMAIL_SMTP_HOST`, plus `EMAIL_IMAP_HOST`, added to the row) and plugins `approval`, `kanban`.
- **Reading is a flow, not a loop.** The plugin ships a curated flow `bandeja-de-entrada` (cron every 5 minutes, the floor; `trigger_detail` «Cada 5 minutos, si hay mails nuevos»). Its run is one tool call away from doing nothing: the run prompt says «mirá si hay mails nuevos», the tool `fetch_mail()` returns the unseen messages (IMAP `UNSEEN` on the inbox, capped at 20, marks them seen, records `Message-ID` in `mail_seen`), and if there are none the run ends in one line and costs a cent. A restart replays nothing because IMAP's seen flag is the state, and `mail_seen` is the second lock.
- **One ticket per thread**, keyed by `In-Reply-To`/`References` → an existing ticket gets the new message as a comment and moves back to «Nuevo»; a new thread is a new ticket. Title = subject, body = the message rendered plain (HTML stripped by code), with sender and date; attachments are saved under `workspace/correo/<ticket>/` and listed.
- **The answer:** the run reads the ticket, reads `marca/brand.md` and the `inbox` skill, drafts the reply, and calls **`send_email(ticket_id, body, note)`**, gated. The tool sends through SMTP with `From: info@…` (the connection's address), `In-Reply-To` and `References` set so it threads in the client's mailbox, records the sent message as a comment, and moves the ticket to «Respondido». The recipient and subject come from the ticket, never from the model: the tool has no `to` argument. A `client_correction` replaces the body, like the caption.
- **The approval plugin's demo `send_email` is deleted**, like `publish_post` was. The gate's own tests move to the mail plugin's tool against the stub SMTP.
- **Discarding:** `update_ticket(id, status="done", comment="…")` with the reason. The skill lists what is not answered: newsletters, notifications, anything with `List-Unsubscribe`, our own bounces. Code marks the obvious ones (`List-Unsubscribe`, `Auto-Submitted`) as `discarded` before the model sees them.
- **The «nunca»**, in the skill and on the catalog row: no price but the diagnóstico's, no date, no promise of what the agent can do beyond the catalog; a question it cannot answer becomes a ticket in «Esperando» with a draft for Luis.
- **What Luis does once:** a Gmail app password for the account that receives `info@` (Cloudflare routes it there), IMAP on, and «Send mail as info@tuagente.uy» verified in Gmail so the SMTP From is accepted. The connection row's `how` says exactly that.

### The instagram plugin

- **`kit/plugins/instagram/`**, capability `instagram-comments` (row: «Que tu agente lea los comentarios de tus posteos, conteste los simples con tu ok y te marque los que son clientes»). Requires connection `instagram` (the token we have carries `manage_comments`) and plugins `approval`, `kanban`. The social plugin's publishing stays where it is; this plugin is reading and replying.
- **Reading is a flow**, `comentarios-instagram`, every 15 minutes. `fetch_comments()` lists our recent media (`GET /{IG_USER_ID}/media?fields=id,caption,permalink,timestamp`, last 10), then each one's comments (`GET /{media_id}/comments?fields=id,text,username,timestamp,replies`), returns the ones not in `instagram_seen`, records them. Our own replies are skipped by username.
- **`reply_comment(comment_id, text, note)`**, gated: `POST /{comment_id}/replies`. The card shows the post's first slide, the comment, and the reply. `hide_comment(comment_id)` for spam, gated too: hiding is an outward act on a public thread.
- **A lead is a ticket**: `create_ticket(source="instagram", source_ref=comment_id)` with the comment, the username, and the post's permalink; the reply, if any, invites them to write to `info@` or by DM (a DM we cannot read yet).
- **Insights for the creator:** `instagram.py` gains `insights(media_id)` (`GET /{media_id}/insights?metric=reach,saved,likes,comments`), and a tool `recent_performance()` on the **creator** sub-agent (read-only, not gated) that returns the last ten posts with their numbers and comment count. The post skill's step 2 («elegí una idea que no repita») reads it: what got saved is what to do more of.
- **DMs are out** until Meta's Advanced Access review; the connection README already says so. The plugin's `plugin.json` lists it as a known limit.
- **The token refresh** becomes the first step of this plugin's flow: if the token is older than 50 days, `refresh_token()` and record the new expiry. The route from the social plugin stays.

### Shared

- **Both flows are curated flows in their plugin** (`flows/` folder, installed with the capability, listed in Flujos, pausable). They are not created in the chat.
- **The face's instructions** get one paragraph per plugin: what lands in the board and how to talk about it («te dejé en el tablero», «está esperando tu ok en Aprobaciones»), never «ya le respondí» before the tool returned.
- **Cost:** a mail tick with nothing new is one short turn (~US$0.001). A reply is a delegation-free turn (~US$0.005). Comments tick the same. Budget for us: well under US$1/day.

## Layout

```
kit/plugins/kanban/core/{plugin.py, store.py, routes.py, tools.py}  the board on the engine
kit/plugins/mail/{plugin.json, core/plugin.py, core/imap.py, core/smtp.py, core/tools.py,
                  core/instructions.md, skills/inbox/SKILL.md, flows/bandeja-de-entrada/FLOW.md}
kit/plugins/instagram/{plugin.json, core/plugin.py, core/graph.py, core/tools.py,
                  core/instructions.md, skills/comments/SKILL.md, flows/comentarios-instagram/FLOW.md}
kit/plugins/social/core/creator.py   + recent_performance on the creator
kit/connections/catalog.json         email row: EMAIL_IMAP_HOST; instagram row: comments
kit/capabilities/catalog.json        rows inbox, instagram-comments
engine/tests/{test_board.py, test_mail.py, test_mail_gate.sh, test_instagram_comments.py}
app/app/pipeline/                    reads source/source_ref for the two links; nothing else
```

## Waves

1. **The board** (Opus): store, routes, tools, `test_board.py`, portal-check green with `kanban`. B1.
2. **Mail** (Opus, after 1): the plugin, the stub IMAP/SMTP in the lab, the flow, the skill, the gate moved. M1–M3.
3. **Instagram** (Opus, parallel with 2 once 1 is in): the plugin, the flow, insights on the creator. I1–I2.
4. **Our agent** (me): the Gmail app password and the send-as alias from Luis, both flows on, one real mail and one real comment, screenshots into the verdict. G.
5. **Validation** (fresh context): rerun the gates; probe a mail with an attachment, a thread with three messages, a comment on a post we did not make, and a token past its refresh window.

## Out of scope, on purpose

Instagram DMs (Advanced Access), the weekly report, Telegram, reading Luis'
personal mail (only the inbox the connection names), calendar booking of the
diagnóstico (the reply says «te escribimos con dos horarios», a person picks
them, until the calendar connection exists on the engine), the blog.

## Risks named up front

- **The model answering mails it should not.** The discard list in code covers the mechanical ones; the skill covers the rest; the gate covers everything. The measure of M3 is by hand until there are real mails to build a test on.
- **IMAP seen-flags as state** break if Luis reads the inbox from his phone first: a mail he opened is `SEEN` and the agent never sees it. Mitigation: a Gmail filter that labels `to:info@` and the agent reads that label, not INBOX; the flow description says so. If it bites, the plugin switches to `SINCE` + `mail_seen` only.
- **Instagram's comment API** returns replies nested; a reply of ours must be identified by username, and the username is `IG_USERNAME`, read once from `/me` at startup and cached in the plugin.
- **Two flows every 5 and 15 minutes** on one agent: the scheduler runs them as separate sessions; nothing in the engine serializes runs. Fine on our Mac; measured before a client gets it.
