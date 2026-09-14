"""Traces to a self-hosted Phoenix, or nothing.

Pydantic AI is OpenTelemetry-native: instrumented, every run is a span tree
with one span per model request (messages in, messages out, usage) and one
per tool call (arguments, return). Phoenix reads OpenInference attributes,
which `OpenInferenceSpanProcessor` derives from Pydantic AI's GenAI ones on
the way out. No Logfire account, no collector: the exporter posts straight
to Phoenix's OTLP endpoint.

Off unless `CORE_OTEL_ENDPOINT` is set, so a client's agent ships no traces
unless its compose says so. `CORE_OTEL_INCLUDE_CONTENT=0` keeps prompts and
completions out of the spans (span shape and timings only), which is the
setting for a client's data.

BINARY CONTENT NEVER TRAVELS, on the lab either. Every post this agent makes
carries a PNG back through `generate_image` and into the model's own history,
and with `include_binary_content` on that image is base64 in the span — a turn
of a few kB of text becomes megabytes of trace, the viewer stalls on it and
nobody reads a picture as a string anyway. The setting is Pydantic AI's own and
it drops the bytes, not the part: the span still says an image was there.
"""

from openinference.instrumentation.pydantic_ai import OpenInferenceSpanProcessor
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from pydantic_ai import Agent, InstrumentationSettings

from . import config


def setup() -> bool:
    if not config.OTEL_ENDPOINT:
        return False
    provider = TracerProvider(resource=Resource.create({"service.name": config.OTEL_SERVICE}))
    provider.add_span_processor(OpenInferenceSpanProcessor())
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=config.OTEL_ENDPOINT)))
    trace.set_tracer_provider(provider)
    Agent.instrument_all(
        InstrumentationSettings(
            tracer_provider=provider,
            include_content=config.OTEL_INCLUDE_CONTENT,
            include_binary_content=False,
        )
    )
    return True
