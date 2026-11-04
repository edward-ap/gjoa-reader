# Local bounded JB2 compatibility patch

Base: MIT djvu-jb2 0.31.0, upstream djvu-rs tag v0.31.0, commit ae9b8434c077f6ecd65cec93f5ce8e167ddefa96 at https://github.com/matyushkin/djvu-rs. Upstream LICENSE is retained. This is a source Cargo patch, not an edit to the Cargo registry.

Record 9 after start resets integer coding contexts while preserving bitmap/ZP state, symbols and resource counters (DjVu specification 11.4.10.2). Before start it retains inherited dictionary-count semantics. The patch covers dictionary/image/indexed paths.

Large symbols have a finite input-backed work budget: clamp(payload_bytes*512,16MiPixels,64MiPixels), bounding both per-symbol and cumulative work. Dictionary limits remain 16MiPixels per symbol/256MiPixels total. The packed page canvas is bounded to 96MiPixels (12MiB packed); indexed canvas retains 64MiPixels. Overflow/page/blit/record/EOF checks remain explicit.

Self-contained regression commands from the checkout:

```powershell
cargo test --manifest-path vendor/djvu-jb2/Cargo.toml compat_
cargo test --manifest-path vendor/djvu-jb2/Cargo.toml --test dos_bounds
```

Full upstream fixture tests require external upstream fixtures and are not certified by these commands. Application corpus regressions are explicit opt-in tests; no book data is bundled. Remove this patch only after a deliberate equivalent upstream update and appropriate decoder/corpus validation.
