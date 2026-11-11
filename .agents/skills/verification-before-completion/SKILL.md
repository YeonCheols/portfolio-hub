---
name: verification-before-completion
description: Use before reporting work as complete or claiming a check passed.
---

# Verification Before Completion

- Identify the command or inspection that directly proves each completion claim.
- Run the full relevant check against the current working tree and inspect its exit status and output.
- Separate verified results from checks that were not run or could not run.
- Do not infer that tests, lint, type checks, or builds pass from a partial check or an earlier run.
- Before handing work off, compare the result with the requested behavior and report any remaining gaps.
