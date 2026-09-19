# Contributing

Thank you for improving Codex Client Provider.

## Development setup

Create an isolated environment and install the development dependencies:

```console
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"
```

On macOS and Linux, use `.venv/bin/python` instead.

Run the required checks before opening a pull request:

```console
ruff check .
ruff format --check .
pyright
pytest
python -m build
twine check dist/*
```

Unit tests must not require a Codex login or network access. If a protocol change
needs live verification, keep the check in `scripts/smoke.py` and document the
Codex CLI version used.

## Release process

1. Update the version in `pyproject.toml`, `src/codex_client_provider/__init__.py`,
   and `src/codex_client_provider/langchain.py`.
2. Update `CHANGELOG.md` and run all checks.
3. Create and push an annotated `vX.Y.Z` tag.
4. Publish a GitHub release for the tag.
5. The `publish.yml` workflow builds the artifacts and uses PyPI Trusted
   Publishing. The repository must be configured as a trusted publisher in the
   PyPI project before the first automated release.

