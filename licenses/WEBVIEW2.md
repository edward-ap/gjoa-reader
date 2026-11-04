# Microsoft WebView2 SDK loader

The Windows MSVC target of webview2-com-sys0.38.2 links WebView2LoaderStatic.lib through its generated src/lib.rs link macro. Its pinned source commit is b74dc5e2b394044bea5191052868ce7a106c202c; CHANGELOG identifies Microsoft.Web.WebView2 SDK1.0.3650.58.

The exact official [NuGet package](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3650.58) was read without installing or executing it. The x64 static library in that package matches the pinned Cargo crate byte-for-byte; the SHA-256 and package/source references are in [webview2/provenance.json](webview2/provenance.json). This is payload provenance evidence, not an independent rebuild of the final executable.

The NuGet package's own nuspec points to [webview2/LICENSE.txt](webview2/LICENSE.txt), a Microsoft BSD3 notice. Preserve that complete text and [webview2/NOTICE.txt](webview2/NOTICE.txt), including its third-party notices and source-access statement. These terms apply separately from the Rust wrapper's MIT and the application MIT; no Microsoft endorsement is implied. NOTICE's aggregate/source-access language is retained verbatim and is not evidence that all listed generator/runtime components are linked into this application.

Only LICENSE/NOTICE/nuspec/provenance files were copied here. The SDK package and loader binaries are not distributed in this source directory. A separately installed WebView2 browser runtime remains a platform prerequisite with its own terms; this notice does not grant rights to bundle runtime/browser installers.
