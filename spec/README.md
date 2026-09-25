# spec/

- **`EXECUTOR-CONTRACT.md`** (to come): what a skill executor is on a SOM bus, as a language-neutral spec:
  - inputs: subscriptions, configured instances;
  - evaluation: deterministic, never writes story state;
  - the `skill.warning.raised` it emits;
  - `causation_id` / `correlation_id`;
  - redelivery, late snapshots, and message types without a 1.0 schema.

  It's built on the library's own [`CONVENTIONS.md`](../upstream/som-1.0/skills/docs/CONVENTIONS.md).
- **`POSITIONS.md`** (to come): one id per RND position on a question the library leaves open (for example, who turns a raised flag into an editorial gate). Each position cites the upstream `spec/open-register.md` item it answers, is labelled an RND position rather than the standard, and is offered upstream.

Tracked in som-bus-reference #62.
