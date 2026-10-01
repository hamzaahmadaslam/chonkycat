---
description: Wake your Chonky Cat up — start the desktop cat if she isn't running
allowed-tools: Bash(node:*)
---

Run this command to start (or wake) the Chonky Cat desktop cat:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/chonky-hook.js" launch && echo "Your chonky cat is waking up 🐾"`

Tell the user in one short, playful sentence their chonky cat (Arshia, unless they renamed her) is on her way. If they have never installed the app, mention that the first start downloads it with `npx chonkycat`, which can take a minute.
