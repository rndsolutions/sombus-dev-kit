# fixtures/

Synthetic test cases per skill, translated from each skill's evaluation table (section 9 of the upstream file). Each case is:
- a trigger message (`story.context` or another recall topic);
- a configured instance;
- the expected warning(s), or none.

Cases that need a message type SOM 1.0 doesn't define (e.g. `asset.ingested`) are kept and labelled **pending spec**, not dropped.

Versioned by suite id: `som-1.0.0+lib-0.2.2`.
