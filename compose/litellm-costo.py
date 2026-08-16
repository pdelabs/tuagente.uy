"""Write down what every model call actually cost.

WHY THIS EXISTS. Hermes prices a call by asking the provider's models API, and
it only knows how to do that when `model.provider` names a provider it
recognises. The day we put litellm in front for observability, the config had to
become `provider: custom` + `base_url: http://litellm:4000` -- and that path is
hardcoded to `billing_mode="unknown"`. So the Uso tab went to $0 and stayed
there. Measured: the agent before litellm recorded real cost per session
(`src=provider_models_api`); every session after it records `status=unknown`.

Observability ate the accounting, and the client is the one who reads that
screen.

litellm already knows the real number -- OpenRouter returns `usage.cost` on
every response and litellm passes it through. This callback appends it to a
JSONL that the portal adapter reads. It is the REAL charge, not an estimate off
a price table we would have to maintain.

RULE, same as the one already written in litellm.yaml: observability can never
take down the agent. Every failure here is swallowed. A missing cost line is a
number the client does not see; an exception is a client whose agent stopped
answering.
"""

import json
import os
import threading
import time
from pathlib import Path

from litellm.integrations.custom_logger import CustomLogger

# Vive en data/, que es el unico volumen que comparten litellm y el adapter.
DESTINO = Path(os.environ.get("COSTO_LOG", "/opt/data/costos.jsonl"))
MAX_BYTES = 8 * 1024 * 1024

_lock = threading.Lock()


def _numero(valor):
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def _uso(response):
    """usage del response, venga como objeto o como dict."""
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")
    if usage is None:
        return {}
    if isinstance(usage, dict):
        return usage
    try:
        return usage.model_dump()
    except Exception:
        return {k: getattr(usage, k) for k in dir(usage) if not k.startswith("_")}


class RegistroDeCosto(CustomLogger):
    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        try:
            self._anotar(kwargs, response_obj, start_time, end_time)
        except Exception:
            pass

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        try:
            self._anotar(kwargs, response_obj, start_time, end_time)
        except Exception:
            pass

    def _anotar(self, kwargs, response_obj, start_time, end_time):
        usage = _uso(response_obj)

        # El costo REAL que cobro el proveedor. litellm lo pasa tal cual desde
        # OpenRouter; si algun dia no viniera, cae a lo que calcule litellm.
        costo = _numero(usage.get("cost"))
        origen = "upstream"
        if costo is None:
            costo = _numero((kwargs.get("standard_logging_object") or {}).get("response_cost"))
            origen = "litellm"
        if costo is None:
            costo = _numero(kwargs.get("response_cost"))
            origen = "litellm"
        if costo is None:
            return  # sin numero no se inventa: mejor nada que un cero falso

        fila = {
            "ts": time.time(),
            "modelo": kwargs.get("model") or getattr(response_obj, "model", "") or "",
            "entrada": usage.get("prompt_tokens") or 0,
            "salida": usage.get("completion_tokens") or 0,
            "costo_usd": costo,
            "origen": origen,
        }

        with _lock:
            # Rotacion simple: esto crece para siempre y nadie lo mira hasta que
            # llena el disco del cliente.
            try:
                if DESTINO.exists() and DESTINO.stat().st_size > MAX_BYTES:
                    DESTINO.replace(DESTINO.with_suffix(".jsonl.1"))
            except OSError:
                pass
            with open(DESTINO, "a", encoding="utf-8") as f:
                f.write(json.dumps(fila, ensure_ascii=False) + "\n")


registro_de_costo = RegistroDeCosto()
