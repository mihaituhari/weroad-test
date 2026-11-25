# AI full stack hiring test

## Use case

WeRoad sells small-group trips. Users find them on a search page: a free-text bar, dates, filters and a list of results. Many users don't know yet what they want, and a good share of text searches return nothing even when matching trips exist.

Build an assistant that lives on the search page and helps the user get to a trip they want to book.

The problem is deliberately bigger than what you can build. We want to see what you choose to build, what you leave out, and why.

## Requirements

- The assistant starts from the user's current search (text, dates, filters).
- The user can refine the search in natural language over several turns (e.g. "only trips with a cooking class", "I only have 19–24 October").
- Sold-out departures are never shown.
- Zero results is not a dead end: the assistant proposes the closest options.

Real integrations, auth and a polished UI are not requirements.

## Data

The samples folder contains 50 trips, 10 departures each (dates, price, status, seats left) and 50 FAQs. Values are fake. Some departure dates are already in the past: feel free to change them if you need to.

## Tech stack

Your choice: any language, framework, model and provider.

Using AI coding tools is encouraged. During the call we expect you to own the repo and its choices, not every line.

## Deliverables

1. A repo with a working prototype and instructions to run it. A deployed link we can open is welcome.
2. A short document explaining your choices.
3. Your AI workflow kept visible: agent configs (AGENTS.md, CLAUDE.md, skills, subagent prompts), prompts and the commit history.
4. A 60-minute call with us: you demo the prototype, make a small change live with your own setup, then we discuss your choices.

## Evaluation points

- AI-assisted development: how you build with AI tools: workflow, the context you give the agents, how you check their output.
- AI stack: model choice, prompt and tool design, how you measure quality, cost and latency.
- Product: does it solve the user's problem? What did you build, and what did you leave out?
- Ownership: scope and trade-offs, what you would ship first, how you would measure its impact.
- Engineering & architecture: structure, code quality, readability, tests where they matter.
