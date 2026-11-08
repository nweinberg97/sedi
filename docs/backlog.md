# Sedi backlog

Ideas agreed on but not built yet. Newest first.

## Builder mode: ship recipes (custom prompts per ship)

*Added Nov 8, 2026.*

**The idea.** When you Ship tasks, you pick what you want the AI to *do* with them, not just which app gets them. Each choice is a short prompt that wraps the tasks. Sedi comes with a few, and you can write your own.

**Starter recipes** (each one wraps the selected tasks, the repo and the project's standing instructions):

| Recipe | What it asks for |
|---|---|
| Build it | Work through these tickets one at a time in the repo, and summarize each change. This is today's default. |
| Sandbox preview | Build a sandbox or preview showing what the app will look like with these tickets done. Don't merge anything. |
| Ship to the repo | Implement these tickets on a branch, open a pull request, and list what to check before merging. |
| Catch me up | Re-summarize everything in this chat so far, then tell me where these tickets fit and what's next. |
| Plan first | Turn these tickets into a step-by-step plan with risks and open questions. Write no code yet. |
| Review and test | Check whether these are done in the repo, run the tests, and report anything broken or missing. |
| Write the spec | Turn these tickets into a short spec with user stories and acceptance criteria. |
| Bug triage | For each ticket, find the likely cause, how to reproduce it, and the smallest fix. |
| Release notes | Write user-facing release notes for these changes, in plain words. |

**How it would work:**

- **Picking a recipe:** Ship and Ship all open a small menu of recipes. The last one you used comes first, so a repeat ship is still one tap. Each project can set a default recipe in Ship settings.
- **Writing your own:** a title plus prompt text, with fill-ins Sedi completes: `{tasks}`, `{repo}`, `{project}`, `{instructions}`, `{count}`. They're kept on this device like everything else.
- **Per app:** a recipe can target an app (Claude, ChatGPT, Gemini…) or use the project's Ship link (a Claude project opens a new chat with everything typed in).
- **Preview:** before opening the app, you can see the final message, with "Edit before sending" when you want it.
- **Sharing:** export and import recipes as a small file, so a team can share a workflow.

**Open questions:**

- Should recipes also exist outside Builder mode (Taskly's "Hand off a list", Brainly notes)?
- Should a sent recipe mark its tasks as "Shipped", with the date and recipe name?

## Phone and tablet polish (from the Oct 29 touch pass)

- The day view's 15-minute blocks are still thin to tap.
- The floating Atom button can briefly cover the last item in some lists.
- Boardly on phones: the category strip shows a cut-off sliver, and the heading slides under the tabs when you scroll.
- Reminders on phones: the right column of notes may touch the corkboard frame.
- Taskly on a sideways iPad: column names like "In progress" get cut off.

## Builder mode: "Mark shipped"

After a ship, offer a quiet tick so handed-off tasks look different from ones you haven't sent yet.
