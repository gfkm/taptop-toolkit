# Project state

The current compiler and extension are prototypes. The compiler has a version-1 sidecar-asset format, which is retired for the product flow. The extension currently validates a JSON plus folder and probes an editor; it does not yet import. Follow the hard gate in `../../docs/mvp-release-plan.md`: reproduce the native transport in a disposable project before adding a production importer.

Current review findings to cover during MVP work:

- grouped CSS selectors may lose declarations when a mapping uses the unsplit selector;
- unsupported HTML attributes can be silently omitted.

Resolve both by explicit normalisation or rejection with tests; do not silently downgrade behaviour.
