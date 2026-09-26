# spec/

What a skill executor is on a SOM bus, and where RND takes a position the skill library leaves open. Both
are published in the SOM Managed Bus docs:

- **[How an executor behaves](https://sombus.rnd-solutions.net/docs/skills/executor-contract)**: what an
  executor subscribes to, how it evaluates, when it raises, and how it handles redelivery, late snapshots
  and message types without a 1.0 schema. Built on the library's own
  [`CONVENTIONS.md`](../upstream/som-1.0/skills/docs/CONVENTIONS.md).
- **[RND positions](https://sombus.rnd-solutions.net/docs/skills/positions)**: one id per position (P-01,
  P-02…), each labelled an RND position rather than the standard. Executors here cite them in their code.

Positions are offered upstream, as issues or pull requests to
[`storyobjectmodel/som`](https://github.com/storyobjectmodel/som), citing the `spec/open-register.md` item
they answer. To question one, open an issue here or use **Ask RND** in the portal.
