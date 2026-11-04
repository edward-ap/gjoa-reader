# Availability of MPL-covered Rust source

Recipients of this source tree are provided the following exact, unmodified upstream source distributions. They are compressed crate source archives, not executable binary dependencies. They preserve upstream source headers and are made available under Mozilla Public License2.0 for their covered files. The [MPL2 text](rust/cssparser-0.36.0/LICENSE) is included verbatim; the [upstream license](https://www.mozilla.org/en-US/MPL/2.0/) describes the applicable rights and conditions.

| Package | Version | Local archive | Upstream archive | Cargo.lock SHA-256 |
|---|---|---|---|---|
| cssparser | 0.36.0 | [included source](rust/mpl-sources/cssparser-0.36.0.crate) | [exact download](https://static.crates.io/crates/cssparser/cssparser-0.36.0.crate) | `dae61cf9c0abb83bd659dab65b7e4e38d8236824c85f0f804f173567bda257d2` |
| cssparser-macros | 0.6.1 | [included source](rust/mpl-sources/cssparser-macros-0.6.1.crate) | [exact download](https://static.crates.io/crates/cssparser-macros/cssparser-macros-0.6.1.crate) | `13b588ba4ac1a99f7f2964d24b3d896ddc6bf847ee3855dbd4366f058cfcd331` |
| dtoa-short | 0.3.5 | [included source](rust/mpl-sources/dtoa-short-0.3.5.crate) | [exact download](https://static.crates.io/crates/dtoa-short/dtoa-short-0.3.5.crate) | `cd1511a7b6a56299bd043a9c167a6d2bfb37bf84a6dfceaba651168adfb43c87` |
| option-ext | 0.2.0 | [included source](rust/mpl-sources/option-ext-0.2.0.crate) | [exact download](https://static.crates.io/crates/option-ext/option-ext-0.2.0.crate) | `04744f49eae99ab78e0d5c0b603ab218f515ea8cfe5a456d7629ad883a3b6e7d` |
| selectors | 0.36.1 | [included source](rust/mpl-sources/selectors-0.36.1.crate) | [exact download](https://static.crates.io/crates/selectors/selectors-0.36.1.crate) | `c5d9c0c92a92d33f08817311cf3f2c29a3538a8240e94a6a3c622ce652d7e00c` |

All five local archive SHA-256 values were verified against the existing Cargo.lock and earlier dependency audit. Machine-readable source URLs, hashes, relative paths and scope flags are in [mpl-sources.json](mpl-sources.json). These are the original crate distributions, not reconstructed source copied from compiler output. No covered source was modified in this preparation.

For example, an archive can be listed/extracted with system tar:

    tar -tzf licenses/rust/mpl-sources/selectors-0.36.1.crate
    tar -xzf licenses/rust/mpl-sources/selectors-0.36.1.crate -C <destination>

The archives contain their package-name/version root directory. Extract into a separate working directory rather than overwriting the application source. Cargo can also retrieve exact locked packages using its normal registry/checksum mechanism.

## Executable recipients

When distributing an executable containing MPL-covered portions, provide these source archives (or a maintained equivalent source route) and this instruction with the distribution. Inform recipients that covered source is under MPL2; do not restrict their MPL rights. For any future modifications, provide the corresponding modified covered source and preserve required notices. A link that is unavailable or does not correspond to the shipped source is not established by this file as sufficient.

MPL is file-level: this availability notice does not state that all application files are MPL, and the application MIT license does not replace MPL on covered third-party source. cssparser-macros is a build/proc-macro component; metadata reachability alone does not prove that its compiler code is physically shipped. Its source is included conservatively with the rest of the audited MPL set.

This source-availability package addresses only the listed MPL crate versions. Other native/third-party conditions, including UnRAR, have separate notices in [RUST_DEPENDENCIES.md](RUST_DEPENDENCIES.md). Distribution completeness and any remaining attribution gaps require review for the actual release contents.
