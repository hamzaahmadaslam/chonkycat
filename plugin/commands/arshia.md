---
description: Wake Arshia up — start the desktop cat if she isn't running
allowed-tools: Bash(node:*)
---

Run this command to start (or wake) the Arshia desktop cat:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/arshia-hook.js" launch && echo "Arshia is waking up 🐾"`

Tell the user in one short, playful sentence that Arshia is on her way. If they have never installed the app, mention that the first start downloads it with `npx arshia-cat`, which can take a minute.
