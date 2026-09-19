"""Opt-in live smoke test for a locally signed-in Codex client."""

from codex_client_provider import CodexAppServerChatModel, codex_client_status


def main() -> None:
    ready, status = codex_client_status()
    if not ready:
        raise SystemExit(f"Codex login is not ready: {status}")

    model = CodexAppServerChatModel(
        model_name="default",
        reasoning_effort="low",
        timeout_seconds=120,
        service_name="codex-client-provider-smoke",
    )
    response = model.invoke("Reply with exactly PROVIDER_READY")
    if response.content.strip() != "PROVIDER_READY":
        raise SystemExit(f"Unexpected model response: {response.content!r}")

    resolved_model = response.response_metadata.get("model", "unknown")
    print(f"PROVIDER_READY model={resolved_model}")


if __name__ == "__main__":
    main()
