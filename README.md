## About

Asterion turns structured, hierarchical data into an explorable 3D galaxy. Any dataset organized as nested levels — domains, subjects, chapters, subtopics, concepts — is rendered as orbiting celestial bodies around a central black hole, complete with gravitational lensing and a glowing accretion disk at the core.

Click any object to open its details panel, track completion, attach notes and reference links, and navigate the hierarchy visually, in real time, in three-dimensional space.

Built with Three.js and Tauri.

---

## Demo

<p align="center">
  <img src="demo/screenshot-1.png" width="800" alt="Galaxy view" />
</p>
---

## Data schema

> **The schema is currently fixed.**
> You can load any dataset into `theory.json`, but it must conform to the existing schema — only text *values* can be replaced for now.
>
> - Flexible/custom schemas — *planned*
> - In-app creation of new objects — *planned*
>
> Asterion was originally built for a highly specialized use case, so these limitations are by design for now, not by accident.

---

## Setup

### 1. Install packages
```bash
npm install
```

### 2. Run in dev mode
```bash
npx tauri dev
```

### 3. Build the executable
```bash
npx tauri build
```

### 4. Locate your build
```
src-tauri\target\release\asterion.exe
```
Installers (`.msi` / `.exe`) are generated alongside, in:
```
src-tauri\target\release\bundle\
```

---

## Maintenance

Remove all build cache and previous installers:
```powershell
Remove-Item -Recurse -Force src-tauri\target
```