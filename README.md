**1. Install Tauri CLI**
```
npm install -D @tauri-apps/cli
```

**2. Init Tauri**
```
npx tauri init
```
When prompted, answer:
- App name: `cs-galaxy` (or anything)
- Window title: `CS Galaxy`
- Web assets location: `../`
- Dev server URL: (just press enter/default is fine, doesn't matter for static)
- Dev command: leave blank (press enter)
- Build command: leave blank (press enter)

This creates a `src-tauri` folder.

**3. Edit `src-tauri/tauri.conf.json`**

replace that file with the file given in root.

**4. Run it in dev mode to test**
```
npx tauri dev
```

**5. Build the .exe**
```
npx tauri build
```

**6. Find your exe**
```
src-tauri\target\release\cs-galaxy.exe
```
(installer .msi/.exe will also be in `src-tauri\target\release\bundle\`)

```
Remove-Item -Recurse -Force src-tauri\target
```
to remove cache