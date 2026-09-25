# registration/

The check the library itself says is missing (upstream `skills/README.md`, "The check that is still missing"): `check_paths.py` resolves **literal** paths, but a house can configure a `{{ config.* }}` path that doesn't resolve, and nothing tells it.

This folder resolves every configured path against the pinned `story-context` schema **at registration time**, before the configured instance is accepted. Once proven here, it's offered upstream as a pull request to `skills/scripts/`.
