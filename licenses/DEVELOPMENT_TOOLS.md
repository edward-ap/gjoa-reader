# Development-tool licenses

These exact packages are locked by package-lock.json and installed only as devDependencies. Their executables/modules are build/test tools, not application runtime payloads. Do not include node_modules, browser installations or compiler tools in a source/binary release merely because they are present locally. The complete optional-platform package list and declarations remain in package-lock.json.

| Package | Locked version | Package license |
| --- | --- | --- |
| @playwright/test, playwright, playwright-core | 1.63.0 | Apache-2.0 |
| @tauri-apps/cli and its optional native platform packages | 2.11.4 | Apache-2.0 OR MIT |
| esbuild and its optional native platform packages | 0.28.2 | MIT |
| typescript | 5.9.3 | Apache-2.0 |

The installed package LICENSE/NOTICE files and package-lock declarations were checked during preparation. npm supplies those upstream texts with the tool packages. If separately redistributing a tool, preserve its own supplied license/NOTICE and analyze that distribution independently; application MIT does not relicense it. Microsoft Edge/WebView2, Rust, Node.js, Windows SDK and MSVC are external build/runtime prerequisites and are not redistributed as project artifacts. WebView2 loader scope is documented in [WEBVIEW2.md](WEBVIEW2.md).
