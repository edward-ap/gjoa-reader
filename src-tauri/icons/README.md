Default Gjøa Reader icon: source.png, glass-book artwork with real transparent exterior corners.
Regenerate: npx tauri icon src-tauri/icons/source.png --output src-tauri/icons
source.svg is the unused legacy icon. Original opaque artwork is retained at art/icon-opaque-original.png.

Transparency correction used built-in image_gen. Prompt: Remove only the dark navy exterior outside the luminous rounded-square glass tile, using a real alpha channel; preserve the glass book, navy tile interior, blue rim, proportions and colors, without cropping or redesign.
PNG and ICO sizes 16/24/32/48/64/128/256 have corner alpha 0. Release reader.exe rebuilt and its extracted icon checked for transparent corners. glass-transparent.ico is a separately named copy for optional shortcut cache refresh.
The previously observed desktop reader shortcut disappeared before the icon-location update; no replacement shortcut was created.
