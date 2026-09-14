# Antigravity Autonomous Agent Rules

## Autonomous Execution Mode
- The user has granted full autonomous execution authority.
- Do NOT pause or block execution to ask the user for permission on ordinary actions (file editing, building, running tests, git commands).
- Do NOT block on Implementation Plan review (`request_feedback = false`). Execute code changes and tests directly.
- Only stop or ask if an action is irreversibly destructive (e.g. permanent deletion of unrelated files).
- Always build, run tests, and report the final verified result directly to the user.
