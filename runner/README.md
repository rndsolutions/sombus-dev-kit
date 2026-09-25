# runner/

`som-skill test`: plays each fixture to an executor as a producer would, and checks the `skill.warning.raised` it emits:
- schema-valid;
- required fields present;
- `causation_id` equals the trigger's `message_id`, and the story's `correlation_id` is kept;
- exactly one warning, or none for no-trigger cases;
- a stable `warning_id` on redelivery;
- within a timeout.

It talks HTTP, so it can test an executor written in any language. Tracked in som-bus-reference #66.
