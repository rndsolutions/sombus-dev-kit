# runner/

`som-skill test` (planned): tests a skill executor against your **vendor workspace's sandbox** on the hosted
bus, so it runs the same gateway rules as production and there's nothing to install but the CLI. It
starts a test run of the skill harness, lets your executor read the harness's messages and publish its
warnings, and checks every `skill.warning.raised` it publishes:
- schema-valid, and accepted by the gateway;
- required fields present;
- `causation_id` equals the trigger's `message_id`, and the story's `correlation_id` is kept;
- exactly the warnings expected, or none for no-trigger cases;
- a stable `warning_id` on redelivery;
- within a timeout.

Your executor talks to the bus over HTTPS, so it can be written in any language. The exit code is 1 when a
case fails, so the same command works in CI.

Until it's available, start the skill harness from the portal's **Test runs** page: same cases, same
checks. See the [docs](https://sombus.rnd-solutions.net/docs/test/test-runs).
