# Skills Announcement Starter (Remotion)

A small Remotion starter inspired by Jonny Burger's coding-session gist:
- macOS Terminal window UI
- typewriter command animation
- streaming output lines + ASCII logo
- blinking cursor that keeps blinking after typing finishes
- a simple 3D-ish "hero" wrapper (`Master`)

## Quickstart

```bash
npm i
npm run dev
```

Render:

```bash
npm run render
```

## Where to edit

- `src/TerminalContent.tsx` – change the command, output lines, timing
- `src/MacTerminal.tsx` – terminal chrome (title bar, padding, fonts)
- `src/Master.tsx` – background + transform/sequence logic
- `src/Root.tsx` – composition settings (size, fps, duration)

