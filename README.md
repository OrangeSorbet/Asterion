**1. Install packages**
```
npm install
```

**2. Run it in dev mode to test**
```
npx tauri dev
```

**3. Build the .exe**
```
npx tauri build
```

**4. Find your exe**
```
src-tauri\target\release\cs-galaxy.exe
```
(installer .msi/.exe will also be in `src-tauri\target\release\bundle\`)

**Others**
Remove build cache:
```
Remove-Item -Recurse -Force src-tauri\target
```