# Glossary

Plania's own words, as the README and the screen use them. One line each, with no implementation
detail. Spanish words are the ones the owner reads on screen; English words are the ones in the tools.
Which screen names keep their Spanish form in English is in [docs/screen-words.md](docs/screen-words.md).

## People and roles

| Word | Meaning |
|---|---|
| Owner (Jorge) | The person the plan belongs to. He decides, approves and ships; agents never do that for him. |
| Roster | The company's list of agents and people. |
| Product owner (PO) | The agent that shapes ideas, writes plans and proposes options for one project. |
| Research | The agent that investigates an idea before it is designed. |
| Artist | The agent that designs an idea and shows it in frames. |
| Taller | The builder: the agent that writes the code for a ticket and hands it over as a delivery. |
| QA | The agent that reviews a delivery in a session that did not see it being built. |
| Seguridad, Copy, Marketing, Data | Specialist agents a project can add to its team. |
| Asistente | The company's chief of staff: it answers the owner in the company thread and routes work across projects. |

## The plan

| Word | Meaning |
|---|---|
| Project | One product, with its own plan, team, rules and thread. |
| Goal | What a project is trying to achieve, and why. |
| Idea | A request still being shaped, not yet built. |
| Stage | Where an idea is: idea, research, design, planning, ready. It moves one step at a time. |
| Stage doc | The document a stage must produce before the idea can move on: Idea, Research, Design, Plan. |
| Frame | One picture of a design, with what it does and why. |
| Initiative | A larger piece of work made of several tickets, with one branch and one pull request. |
| Route | A project's open initiatives, in the order planned. |
| Leg | One initiative on the route. |
| Ticket | One piece of work a single session can finish. |
| Phase | A ticket that is a numbered step of an initiative. |
| Scope | What a ticket or initiative is, in words. |
| Done when (checks) | The list of things that must be true for a ticket to count as finished. |
| Check list | Three things the product owner asks QA to verify on every step of a leg. |
| Blocker | What a ticket waits on: another ticket, a deploy, a date, a number, or something the owner must do. |
| Decision | One line in the project's decision log. A pinned decision is one every session must keep. |
| Assumption | A decision an agent took on the owner's behalf, recorded so he can reverse it. |

## Asking and answering

| Word | Meaning |
|---|---|
| Pedido | Something the owner asks for on screen. |
| Pedir | The place where he asks. He chooses to shape it into an idea, to have it done now, or to ask a question. |
| Preguntar | Asking the product owner a question and getting an answer; it creates no idea and no ticket. |
| Order | A pedido as the agents see it: the ticket a plan answers. |
| Proposal | Options, or a plan, that a product owner puts to the owner as something he can answer with a tap. |
| Question | Something an agent asks the owner about a ticket; the ticket waits until he answers. |
| Human-only question | A question only the owner's own screen may answer. |
| Needs owner | The state of a ticket that waits on the owner's answer. |
| Te toca | Everything that cannot go on until the owner acts, across all projects, one card at a time. |
| Bandeja | The inbox: the list of what waits on the owner. |
| Thread | The conversation where a project's agents report and the owner answers. The company thread is the Asistente's. |

## Building and delivering

| Word | Meaning |
|---|---|
| Run | One wake of one agent: a single headless session with a start, an end and a result. |
| Runner | The part of Plania that wakes agents and starts their runs. |
| Claim (lease) | A session's timed hold on a ticket, so that nobody else works on it. |
| Heartbeat | Two things: how often an agent may be woken, and a session renewing its claim. |
| Handoff | Passing a claim to another session, with a note. |
| Workspace | The folder and branch where a run works on a ticket. |
| Sandbox | The branch where approved deliveries land before a release. On screen: «la copia de prueba». |
| Delivery (entrega) | A ticket's finished work, handed over for review with its evidence. |
| Evidence (result) | A record of what was run, on which commit, and what it showed. |
| Verify list | The project's own checks, which Plania runs on every delivery. |
| Muestra | What comes with a delivery that changes the screen: one sentence for the owner, the views it touched, and three ways to try it. |
| El Probador | Before-and-after pictures of a delivery, at desktop and phone width, with the changes marked. |
| Copia de prueba (test copy) | The app, started on the Mac from the sandbox branch or from a delivery, so it can be tried. |
| QA lane | What happens to a delivery before the owner sees it: the checks, the pictures, the review. |
| Devuelta (returned) | A delivery sent back to Taller, by QA or by the owner's «Pedir cambios». |
| Retro | A look at a returned delivery that proposes at most one fix so it does not happen again. |
| Release | The step that takes what is in sandbox to production. Only the owner ships it. |
| Lanzar | Shipping a release from the screen. |
| Footprint | Something an agent left running or stored on the Mac, registered with how to remove it. |

## What agents know

| Word | Meaning |
|---|---|
| Role prompt | The text that tells an agent who it is and what it may never do. |
| Skill | A procedure an agent follows for one kind of work, loaded only when that work comes up. |
| Kit | The role prompt and the skills a run was given. Also the folder in this repo that holds them. |
| Pack | The older name and form of a skill: one document handed to the roles that carry it. |
| Project context | Three short notes per project: its words, its commands, and where things live. |
| Protocol | The order of work every agent follows, served by Plania itself. |
| Rules | A project's own additions to the protocol. |

## The screen

| Word | Meaning |
|---|---|
| Inicio | The home screen: every project at a glance, what waits on the owner, what the Mac is running. |
| La corriente | The company screen: every project's work as a stream, by stage. |
| Compañía | The company view, where the threads and the teams are. |
| Piso (floor) | One project's level in the company view. |
| Lane | One row of the board per open initiative, always with the same five columns. |
| Sueltos | The lane for tickets that belong to no initiative. |
| Hoy | What changed since the owner last looked. |
| Orden | The project's audit on screen: what is out of place, and who can fix it. |
| Máquina | What agents have running and stored on the Mac. |
| Motores | Where the owner sets which model and effort each agent's runs use, and how many run at once. |
| Morning brief | A daily summary of every project, prepared before the owner starts his day. |
| Headline | One line on where a project stands. |
| Readiness | Whether a project can be picked up right now: ready, caution, blocked, or nothing to resume. |
| Digest | What changed since a given moment, per project. |
| Buzón | The first stop of La corriente: where a pedido lands before anyone shapes it. |
| Plomería | The machine's plumbing on one page: whether the company runs, the plan's brake, what the models spent, the switches per project, the last runs, the language. |
| Docs del proyecto | A project's own docs, in Ajustes: the three context notes every run reads, and the library the team looks up. Archivo, which listed every doc, is gone (PLA-135). |
| Tablero | The board of one project's work, by stage; also the building's switchboard of apps on Máquinas. |
| Ficha | The card of one thing (pedido, idea, initiative, ticket) with everything about it, opened from any list. |
| Máquinas | A project's services on the Mac: how its app starts, what is running, the test copies. |
| Novedades | The page with the notes of the last Plania update. |
| Calidad | The quality scoreboard: how runs ended, what QA returned, how long things took. |
| Progreso | What was closed, by day, project and year. |
| Aceptar | The owner's click that merges a delivery into the test copy. |
| Pedir cambios | The owner's click that sends a delivery back to Taller with what to change. |
| Delegada | The badge on an answer the Plania bot recorded for the owner, quoting the owner's message. |
