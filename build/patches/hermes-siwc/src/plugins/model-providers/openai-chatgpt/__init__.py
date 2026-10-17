from __future__ import annotations

import math
import time
from typing import Any, Callable

from providers import register_provider
from providers.base import OMIT_TEMPERATURE, ProviderProfile


class ChatGPTPlanProfile(ProviderProfile):
    def __init__(self, read_grant: Callable[[], dict[str, Any] | None] | None = None):
        super().__init__(
            name="openai-chatgpt", aliases=("siwc_responses",), api_mode="codex_responses",
            env_vars=(), base_url="https://api.openai.com/v1", auth_type="oauth_external",
            requires_streaming=True, allows_fallback=False,
            fixed_temperature=OMIT_TEMPERATURE, supports_vision=True,
        )
        self._read_grant = read_grant

    def _access_token(self) -> str:
        from hermes_cli.auth import AuthError

        try:
            grant = self._read_grant() if self._read_grant is not None else None
        except Exception:
            raise AuthError("ChatGPT plan authorization could not be read.",
                            provider=self.name, code="siwc_authorization_required") from None
        if not isinstance(grant, dict):
            raise AuthError("Independent ChatGPT plan authorization is required.",
                            provider=self.name, code="siwc_authorization_required")
        expires = grant.get("expires_at")
        scopes = grant.get("scope")
        client_id = grant.get("client_id")
        token = grant.get("access_token")
        valid = (
            isinstance(expires, (int, float)) and not isinstance(expires, bool)
            and math.isfinite(expires) and expires > time.time()
            and isinstance(scopes, str)
            and {"resource.invoke", "chatgpt.tokens.use.direct"}.issubset(scopes.split())
            and isinstance(client_id, str) and bool(client_id)
            and client_id != "dynamic_agent_client"
            and isinstance(token, str) and bool(token)
            and grant.get("identity_verified") is True
            and grant.get("zero_credit_verified") is True
            and grant.get("audience") == "https://api.openai.com/v1"
        )
        if not valid:
            raise AuthError("ChatGPT plan authorization is unavailable or unverified.",
                            provider=self.name, code="siwc_authorization_required")
        return token

    def resolve_runtime_credentials(self, **context: Any) -> dict[str, Any]:
        from hermes_cli.auth import AuthError

        if context.get("explicit_api_key") or context.get("explicit_base_url"):
            raise AuthError("The ChatGPT plan route requires its independent grant and public endpoint.",
                            provider=self.name, code="siwc_route_override_refused")
        return {"api_key": self._access_token(), "source": "independent-siwc"}

    def create_client(self, **client_kwargs: Any) -> Any:
        from openai import OpenAI

        client_kwargs["api_key"] = self._access_token()
        client_kwargs["base_url"] = self.base_url
        client_kwargs["max_retries"] = 0
        return OpenAI(**client_kwargs)

    def supported_reasoning_efforts(self, model: str | None) -> tuple[str, ...]:
        from agent.reasoning_effort import codex_supported_efforts

        return codex_supported_efforts(model)

    def prepare_responses_kwargs(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "model", "instructions", "input", "tools", "reasoning", "service_tier", "text",
            "include", "store", "prompt_cache_key", "tool_choice", "parallel_tool_calls", "timeout",
        }
        request = {key: value for key, value in kwargs.items() if key in allowed}
        request["store"] = False
        tools = request.get("tools") or []
        if not isinstance(tools, list) or any(
            not isinstance(tool, dict) or tool.get("type") != "function" for tool in tools
        ):
            raise ValueError("ChatGPT plan requests require Hermes function tools.")
        request["tools"] = ([{
            "type": "namespace", "name": "hermes", "description": "Hermes approved tools",
            "tools": tools,
        }] if tools else [])
        inputs = request.get("input")
        if not isinstance(inputs, list):
            raise ValueError("ChatGPT plan requests require full input history.")
        normalized = []
        for item in inputs:
            if not isinstance(item, dict) or item.get("role") == "system":
                raise ValueError("ChatGPT plan input is invalid.")
            if item.get("type") == "function_call":
                if item.get("namespace") not in (None, "hermes"):
                    raise ValueError("ChatGPT plan tool namespace does not match.")
                item = {**item, "namespace": "hermes"}
            normalized.append(item)
        request["input"] = normalized
        return request


register_provider(ChatGPTPlanProfile())
