---
name: quickpoll
description: Collect questions for the client into a QuickPoll draft and turn it into a ready poll link. Use when the user says a question should go to the client ("спросим заказчика", "в опрос", "добавь в квиз/опрос для клиента", "add to the client poll", "quickpoll"), wants to offer design variants for the client to choose from, or asks to build / show / send the poll.
---

# QuickPoll — client polls from Claude Code

QuickPoll is the user's own tool for quick click-through polls for clients
(site: https://avasilevskaya-wq.github.io/quickpoll/). A whole poll lives inside its link,
answers go to the user's Google Sheet. This skill keeps a **draft per poll in the current
project** and builds links with `qp.mjs`, which sits next to this file.

## Where drafts live

- `quickpoll/<poll-name>.md` in the root of the current project, one file per poll
  (e.g. `quickpoll/homepage-directions.md`). Images for it go to `quickpoll/images/`.
- If the user doesn't say which poll: if exactly one draft exists, use it; otherwise list the
  drafts and ask. Start a new one only when asked or when none exists:
  `node "<this skill's folder>/qp.mjs" new quickpoll/<poll-name>.md "Poll title"`
- The file name sets the poll id. Rebuilding the same file updates the same poll (and the same
  tab in the answers sheet). For a new round after the client has answered, make a new file
  (e.g. `homepage-directions-2.md`).

## Draft format (same as the builder's Text tab)

```
# Poll title
> Short intro for the client (optional, can be several > lines)
[ask name]                                  ← optional: ask the respondent's name

// Lines starting with // are team notes: context, who asked, date. Never shown to the client.
Which direction feels closest to your brand?
? Optional hint shown under the question
- Calm and minimal
- Bold and colourful

Which pages matter most? [multi]
- Home
- Pricing

Should we keep the current logo? [yes/no]
How happy are you with the current site? [1-5: Not at all | Very happy]     ← or [1-10]
Which homepage do you prefer? [images]
- Option A | images/home-a.png              ← local file (uploaded on build) or https:// link
- Option B | https://…
Anything else we should know? [text]

Do you approve this flow? [yes/no, comment]
? Have a look at the three screens.
link: Open the prototype | https://www.figma.com/proto/…   ← a link button under the hint (any type)
image: images/step-1.png                                   ← pictures to look at, not to choose (any type)
image: images/step-2.png
```

Flags go inside the brackets, comma-separated: `multi`, `yes/no`, `1-5` / `1-10` (with optional
`: low | high` labels), `images` (+ `grid` / `row` / `full` layout), `text`, `optional`
(choice questions are required by default), `required` (for text questions), `comment`
(lets the client add a comment). Separate questions with a blank line.
Web addresses inside a hint become clickable automatically.

### Link button and pictures (any question type)

Put these lines under the question, after the `?` hint (if any) and before the options:

- `link: Button text | https://…` — one link button per question, shown under the hint, opens in
  a new tab. Use it for a prototype, a Figma file, a doc. Button text up to ~60 characters; if the
  text is left out, the button says "Open link". The address must be a full `https://` link.
- `image: path-or-link` — a picture shown with the question, **to look at, not to choose**: the
  client can enlarge and page through the pictures, then answers the question as usual
  (yes/no, scale, options, text, comment). One `image:` line per picture, up to 12, in the order
  they should appear. A local path (relative to the draft, e.g. `images/step-1.png`) is uploaded
  on build, exactly like local paths in `[images]` options; an `https://` link is used as is.

When to use which:
- the client should **look at screens and then react** (approve, rate, comment) → `image:` lines
  on a `[yes/no]`, `[1-5]`, choice or text question;
- the client should **pick one of several pictures** → an `[images]` question with `- Label | path`
  options.

## How to add questions

1. Append to the end of the draft unless the user says otherwise. Keep the user's language
   for client-facing text; if the draft already has a language, follow it.
2. Write for a busy client: one short question, 2–6 short options, no internal jargon.
   Prefer `[images]` when the choice is visual (design variants, screens, layouts).
3. Put context in a `//` note above the question: where it came from (design session, BA call),
   date, what the team needs the answer for. This helps later when reading the answers.
4. Images: save the exact variants or screens (export or screenshot) into `quickpoll/images/` with
   clear names and reference them by relative path — in `[images]` options (`- Label | path`) or in
   `image:` lines. Up to 8 MB each, png/jpg/gif/webp.
5. A link the client should open (prototype, Figma, doc) goes into a `link:` line, not into the
   question text. A link mentioned in passing can stay in the `?` hint — it becomes clickable.
6. Run `node "<this skill's folder>/qp.mjs" check quickpoll/<poll>.md` and show the user the
   short summary it prints, plus any PROBLEMS. Fix problems in the draft, not in the output.

## How to build the poll

When the user asks to build / get the link / send the poll:

1. `node "<this skill's folder>/qp.mjs" build quickpoll/<poll>.md`
   It uploads local images from `[images]` options and `image:` lines (once — cached in `quickpoll/.quickpoll-cache.json`), checks the poll
   and prints two links:
   - **CLIENT LINK** — this is what the client opens;
   - **EDIT IN BUILDER** — opens the poll in the QuickPoll builder to review or tweak by hand.
2. Give the user both links and suggest a one-line message for the client, e.g.
   "Hi! Could you answer a quick poll? 4 questions, about a minute — just tap your answers: <link>".
3. Never send anything to the client yourself and never edit the user's answers sheet.

## Setup and troubleshooting

- Needs Node 18+. Settings are optional, in `~/.quickpoll.json`:
  `{ "uploadKey": "…", "dir": "C:/path/to/quickpoll" }`
  - `uploadKey` — needed only for local images; the same key as in the builder's Settings.
  - `dir` — local copy of the quickpoll repo, used if the site can't be reached.
- "Local images need the upload key" → ask the user for the key (builder → ⚙ Settings → Upload key)
  and save it to `~/.quickpoll.json`. Don't print the key back in chat.
- "Could not reach …" → no internet, or set `dir` as above.
- Links are long because the whole poll is inside. If the script warns about length, shorten texts
  or suggest sending by email.
