#!/usr/bin/env python3
"""Provider-aware, fail-closed model routing for PRODX Gemini PR reviews."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_DEVELOPER_API_MODELS = frozenset({"gemini-3.8-flash", "gemini-3.1-pro-preview"})
AGENT_PLATFORM_MODELS = frozenset({"gemini-4-neon", "gemini-4-argon"})


class ModelRouteError(Exception):
    """Safe model-routing error; never includes credentials or response bodies."""


def selected_model() -> str:
    model = os.environ.get("AI_REVIEW_MODEL", "gemini-3.8-flash").strip()
    if model in GEMINI_DEVELOPER_API_MODELS:
        return model
    if model in AGENT_PLATFORM_MODELS:
        raise ModelRouteError(
            f"{model} requires the separate Gemini Enterprise Agent Platform adapter; "
            "it cannot be called through the Gemini Developer API key route."
        )
    raise ModelRouteError("AI_REVIEW_MODEL is not in the Gemini Developer API allowlist.")


def generate_content_url(model: str | None = None) -> str:
    selected = model or selected_model()
    if selected not in GEMINI_DEVELOPER_API_MODELS:
        raise ModelRouteError("Model is not permitted on the Gemini Developer API route.")
    return f"{GEMINI_API_BASE}/models/{selected}:generateContent"


def _request_json(url: str, api_key: str, method: str = "GET",
                  payload: dict[str, Any] | None = None) -> Any:
    headers = {"Accept": "application/json", "x-goog-api-key": api_key,
               "User-Agent": "PRODX-Gemini-Capability-Diagnostic"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        raise ModelRouteError(f"HTTP_{error.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise ModelRouteError("NETWORK_OR_INVALID_RESPONSE") from None


def diagnose_developer_api(api_key: str) -> dict[str, Any]:
    """List available models and issue one minimal generation probe per supported ID."""
    if not api_key:
        raise ModelRouteError("GEMINI_API_KEY_MISSING")
    response = _request_json(f"{GEMINI_API_BASE}/models", api_key)
    items = response.get("models", []) if isinstance(response, dict) else []
    supported: dict[str, set[str]] = {}
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            methods = item.get("supportedGenerationMethods", [])
            supported[item["name"].removeprefix("models/")] = {
                method for method in methods if isinstance(method, str)
            } if isinstance(methods, list) else set()

    result: dict[str, str] = {}
    for model in sorted(GEMINI_DEVELOPER_API_MODELS):
        if "generateContent" not in supported.get(model, set()):
            result[model] = "NOT_LISTED_OR_GENERATE_CONTENT_UNSUPPORTED"
            continue
        try:
            _request_json(generate_content_url(model), api_key, "POST", {
                "contents": [{"role": "user", "parts": [{"text": "Reply with OK."}]}],
                "generationConfig": {"temperature": 0, "maxOutputTokens": 8},
            })
            result[model] = "PASS"
        except ModelRouteError as error:
            result[model] = str(error)
    return {
        "provider": "gemini-developer-api",
        "models": result,
        "agent_platform": {
            model: "NOT_TESTED_REQUIRES_AGENT_PLATFORM_PROJECT_AND_CREDENTIALS"
            for model in sorted(AGENT_PLATFORM_MODELS)
        },
        "antigravity": "SEPARATE_CLI_AUTH; GEMINI_API_KEY_REQUIRES_modelProvider_gemini",
    }


def main() -> int:
    try:
        report = diagnose_developer_api(os.environ.get("GEMINI_API_KEY", ""))
    except ModelRouteError as error:
        report = {"provider": "gemini-developer-api", "status": str(error)}
        print(json.dumps(report, sort_keys=True))
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0 if any(value == "PASS" for value in report["models"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
