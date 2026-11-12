# sched-prod incident board — plan

The on-call board for sched-prod. One page, one list: tonight's incidents, newest first, so on-call sees
what just broke and takes it.

## Flows

| flow | who | what happens |
|------|-----|--------------|
| `open-board` | on-call | opens the board; sees tonight's incidents |
| `ack-incident` | on-call | picks an incident on the board, opens its panel and acks it there — "I've got this one" |
| `watch-board` | on-call | keeps the board open; it stays current without a reload |

## Requirements

- **R1** New incidents appear live at the top of the list, newest first.
- **R2** A row opens that incident's panel; the panel names the incident and holds the **Ack**. Ack sends the ack (`api.ack(id)`) and marks the row acked. The ack names the incident the panel is open on, so a landing incident moving the list cannot retarget it.
- **R3** Show a loader until incidents load.
- **R4** The board refreshes itself every 2 seconds while open.
- **R5** Times show in the viewer's local time; day before month for EU locales (dd/mm).
- **R6** The page names its build: `<meta name="build" content="<git sha>">` in the head and the same sha in the footer.

## Hooks (pinned — tests and the replay rely on them)

| `data-testid` | element |
|---------------|---------|
| `board` | the board's main area |
| `loader` | the loader (gone once incidents load) |
| `empty` | what shows when there are no incidents |
| `incident-list` | the list |
| `incident-row` | one incident row, with `data-id="<incident id>"` |
| `incident-panel` | the panel for one incident, with `data-id="<incident id>"` |
| `panel-ack` | the Ack button in the panel |
| `acked` | the acked mark in a row |
| `build-sha` | the sha in the footer |

## Decision

2026-11-12, product, after the step-one recording at 00:13: an ack was aimed at INC-9327 while the pointer
rested on its row, a new incident (INC-2183) landed at the top and moved the rows down, and the ack went to
INC-2183. Product decided: new incidents stay live at the top, and Ack leaves the row — a row opens its
incident panel and Ack lives there. The row's `ack` hook goes; `incident-panel` and `panel-ack` replace it.

## Done

Every issue in `issues/` delivered, deployed to a public https address, and shown working.
