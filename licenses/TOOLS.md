# Build and test tooling

These exact installed tools are development dependencies only, not runtime JavaScript dependencies. Their binaries/node_modules/browser installations are not included in the application or notices bundle. Preserve their own notices if redistributing the tools themselves.

| Package | Version | Declared license |
|---|---|---|
| @esbuild/win32-x64 | 0.28.2 | MIT |
| @playwright/test | 1.63.0 | Apache-2.0 |
| @tauri-apps/cli | 2.11.4 | Apache-2.0 OR MIT |
| @tauri-apps/cli-win32-x64-msvc | 2.11.4 | Apache-2.0 OR MIT |
| esbuild | 0.28.2 | MIT |
| playwright | 1.63.0 | Apache-2.0 |
| playwright-core | 1.63.0 | Apache-2.0 |
| typescript | 5.9.3 | Apache-2.0 |

The preinstalled Rust compiler/standard library, MSVC/Windows SDK, system tar and WebView2/browser are separately supplied platform/toolchain prerequisites. This repository does not grant licenses to their redistributables or bundle their installers. npm runtime dependencies: none.
