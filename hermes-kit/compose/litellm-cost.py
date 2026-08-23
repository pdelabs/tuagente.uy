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

# Lives in data/, the only volume litellm and the adapter share.
COST_LOG = Path(os.environ.get("COST_LOG", "/opt/data/costs.jsonl"))
MAX_BYTES = 8 * 1024 * 1024

_lock = threading.Lock()


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _usage(response):
    """The response's usage, whether it comes as an object or a dict."""
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


class CostLogger(CustomLogger):
    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        try:
            self._log(kwargs, response_obj, start_time, end_time)
        except Exception:
            pass

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        try:
            self._log(kwargs, response_obj, start_time, end_time)
        except Exception:
            pass

    def _log(self, kwargs, response_obj, start_time, end_time):
        usage = _usage(response_obj)

        # The REAL cost the provider charged. litellm passes it through as-is
        # from OpenRouter; if it were ever absent, fall back to what litellm
        # itself computes.
        cost = _number(usage.get("cost"))
        source = "upstream"
        if cost is None:
            cost = _number((kwargs.get("standard_logging_object") or {}).get("response_cost"))
            source = "litellm"
        if cost is None:
            cost = _number(kwargs.get("response_cost"))
            source = "litellm"
        if cost is None:
            return  # no number: better nothing than a false zero

        row = {
            "ts": time.time(),
            "model": kwargs.get("model") or getattr(response_obj, "model", "") or "",
            "input_tokens": usage.get("prompt_tokens") or 0,
            "output_tokens": usage.get("completion_tokens") or 0,
            "cost_usd": cost,
            "source": source,
        }

        with _lock:
            # Simple rotation: this grows forever and nobody looks at it until
            # it fills up the client's disk.
            try:
                if COST_LOG.exists() and COST_LOG.stat().st_size > MAX_BYTES:
                    COST_LOG.replace(COST_LOG.with_suffix(".jsonl.1"))
            except OSError:
                pass
            with open(COST_LOG, "a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")


cost_logger = CostLogger()
