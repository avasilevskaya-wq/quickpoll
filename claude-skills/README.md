# Skills for Claude Code

## quickpoll

Lets Claude Code collect questions for a client into a poll draft (in the project you work on)
and turn it into a QuickPoll link — see `quickpoll/SKILL.md`.

Install (once, and again after updates): copy the `quickpoll` folder to your personal skills folder
- Windows: `%USERPROFILE%\.claude\skills\quickpoll`
- macOS / Linux: `~/.claude/skills/quickpoll`

Needs Node 18+ (`node -v`). For local images, create `~/.quickpoll.json` with your upload key:
`{ "uploadKey": "…" }` (the same key as in the builder's Settings).
