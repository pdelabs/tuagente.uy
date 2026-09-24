"""The engine's side of the socket: HTTP to the bridge, on loopback.

THE BRIDGE IS A SECOND PROCESS IN THIS SAME CONTAINER (`engine/whatsapp-bridge/`,
Go, whatsmeow). The entrypoint starts it only when this plugin is in
`CORE_PLUGINS`, generates the token both sides share, and exports it to both, so
there is nothing for anybody to configure:

    WHATSAPP_BRIDGE_URL     default http://127.0.0.1:8645
    WHATSAPP_BRIDGE_TOKEN   the X-Bridge-Token both sides check

Every variable is read AT CALL TIME, so a test can point this module at a stub.

A refusal from the bridge is `BridgeError` with the HTTP status on it: 503 is
«not connected», 429 is WhatsApp's `rate-overlimit` (the bridge has already
paused that class of call for 30 minutes — nothing here retries), anything else
is the bridge or WhatsApp failing.
"""

import os

import httpx

TIMEOUT = 40  # a send has 30 s inside the bridge, plus the gap between parts


class BridgeError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def url() -> str:
    return os.environ.get("WHATSAPP_BRIDGE_URL", "http://127.0.0.1:8645").rstrip("/")


def token() -> str:
    return os.environ["WHATSAPP_BRIDGE_TOKEN"]


def call(method: str, path: str, body: dict | None = None, timeout: float = TIMEOUT) -> httpx.Response:
    """One request, and the response when it is a 2xx. A refusal raises."""
    try:
        res = httpx.request(method, url() + path, json=body, timeout=timeout,
                            headers={"X-Bridge-Token": token()})
    except httpx.TransportError as exc:
        raise BridgeError(502, f"the WhatsApp bridge is not answering: {exc}") from exc
    if res.status_code >= 400:
        try:
            message = res.json().get("error") or res.text
        except ValueError:
            message = res.text
        raise BridgeError(res.status_code, message)
    return res


def status() -> dict:
    return call("GET", "/status", timeout=3).json()


def send(chat: str, text: str, reply_to: str | None = None) -> dict:
    body = {"to": chat, "text": text}
    if reply_to:
        body["reply_to"] = reply_to
    return call("POST", "/messages", body).json()


def typing(chat: str, composing: bool = True) -> None:
    call("POST", f"/chats/{chat}/typing", {"state": "composing" if composing else "paused"})


def read(chat: str, message_ids: list[str]) -> None:
    call("POST", f"/chats/{chat}/read", {"message_ids": message_ids})


def events_after(seq: int) -> list[dict]:
    return call("GET", f"/events?after={seq}", timeout=5).json()["events"]
