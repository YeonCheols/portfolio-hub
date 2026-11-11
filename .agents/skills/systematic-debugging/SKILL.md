---
name: systematic-debugging
description: Use when a bug, failing test, or unexpected result needs investigation before changing code.
---

# Systematic Debugging

1. Capture the exact error and reproduce the behavior when possible.
2. Inspect the relevant recent changes, configuration, and working examples.
3. Trace the failing value or request through each boundary to find where it first becomes incorrect.
4. State the evidence for the root cause before proposing a fix.
5. Make the smallest fix at the source, then verify the original failure and nearby behavior.
6. If it cannot be reproduced, report what was checked and what evidence is still missing instead of guessing.
