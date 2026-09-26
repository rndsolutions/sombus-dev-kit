# SDKs

Client libraries for SOM Managed Bus: publish now; consume and run skills next. One design, one
conformance kit, several languages.

| | |
|---|---|
| [DESIGN.md](DESIGN.md) | the language-neutral design every SDK implements |
| [conformance/](conformance/) | the shared test cases every SDK must pass in CI |
| [typescript/](typescript/) | TypeScript/Node, the reference implementation: first slice |

Python, .NET and Java follow the design once the TypeScript SDK has proved it.

**Status: pre-release.** Nothing is published to a package registry yet. Names and details may change
before the first release.

**Claims.** Passing the kit means "passes the som-bus checks for `som-1.0.0+lib-0.2.2`". It isn't
certification, and it isn't endorsed by the SOM working group.
