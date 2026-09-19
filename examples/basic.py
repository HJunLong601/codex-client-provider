"""Minimal Codex Client Provider example."""

from codex_client_provider import CodexAppServerChatModel, codex_client_status


def main() -> None:
    ready, status = codex_client_status()
    if not ready:
        raise SystemExit(status)

    model = CodexAppServerChatModel(
        model_name="default",
        reasoning_effort="low",
        timeout_seconds=120,
    )
    response = model.invoke("Reply with one sentence confirming that the provider works.")
    print(response.content)


if __name__ == "__main__":
    main()
