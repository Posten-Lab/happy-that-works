# Workflow UI/UX review

**Result: accepted for the covered flows.** No unresolved P1 or P2 UI/UX findings remain from this review. Reviewed on 14 September 2026 after the final keyboard-clearance changes.

The Codex reviewer implemented the navigation entry points and independently reviewed the wizard, agent editor, launch screen, keyboard scaffold, and run-detail error handling. The review used actual Chrome interactions against the isolated `nimble-fjord` services, source inspection, and visual inspection of the final iPhone simulator screenshots. Native interactions and captures were performed by the implementing agent and inspected independently; the reviewer did not operate the simulator.

## Acceptance against the reported problems

| User concern | Observed result | Evidence |
| --- | --- | --- |
| Workflows is hard to find | A phone tab and persistent desktop destination are present when both experimental flags are enabled. All phone destinations return to the correct view. Ordinary New session navigation remains functional. | [Seven navigation checks](nav-validation.json), [phone](nav-phone-home.png), [desktop](nav-desktop-library.png) |
| Create looks already selected | The library opens without a draft form. Create workflow is a neutral action, distinct from the active navigation destination. | [Library](library-saved.png) |
| Creation needs a wizard | Basics → Team → Finish → Review has clear progress and persistent Back/Continue actions. The reviewer created three agents in an unsaved draft, exercised validation, and checked the final approval and completion-check summary. | [Basics](wizard-basics.png), [Team](wizard-team-top.png), [Finish](wizard-finish.png), [Review](wizard-review.png) |
| Keyboard hides important content | The final native captures show focused text and the relevant action above the software keyboard, including wrapped multiline fields and the separate project modal. | [Description](native-basics-keyboard.png), [agent reference](native-agent-reference-keyboard.png), [check command](native-finish-keyboard.png), [task](native-run-keyboard.png), [project path](native-project-keyboard.png) |
| Errors are unintelligible | Form validation names the correction. Launch errors explain how to recover. Operational run errors are translated; exact diagnostics require a disclosure. Successful background polling no longer dismisses an action error. | [Actual bad-path recovery](launch-path-error.png), source review of `errors.ts` and the run-detail screen |
| Running a workflow is difficult | A saved workflow opens a task field, machine row, shared project picker, and fixed Start action. Actual browser/service evidence records completion through Codex, Claude, and Muse, plus request recovery and preservation of the ordinary session draft. | [Launch screen](review-round2-launch.png), [launch results](launch-validation.json), [recovery results](launch-recovery-validation.json) |

## Findings and review loop

| Finding | Correction and verification |
| --- | --- |
| P2: Team guidance pushed the first Add planner action partly behind the fixed footer on a 390×844 phone viewport. | The machine card and repeated instructions were reduced. [Final Team](wizard-team-top.png) shows Add planner and Stage settings fully above the footer; compare [round one](review-round1-team.png). |
| P2: Opening Run produced an “Unexpected text node” development toast over Start. | Empty-string conditional children were replaced with boolean guards. A fresh browser library → Run check produced no rendering errors and the [settled launch frame](review-round2-launch.png) is clear; compare [round one](review-round1-launch.png). |
| P2: Run overview and Activity still exposed raw provider or schema failures. | Operational reasons and interrupted-task errors now have recovery copy, while normal coordinator decisions and agent summaries remain intact. Exact diagnostics are available through an explicit disclosure. Source was re-reviewed after the change. |
| P2: A successful four-second poll could immediately erase a rejected action's guidance. | Connection errors and action errors now have separate state. Action errors remain until dismissal or another successful action. Source re-review confirmed the separation. |
| P2: The first native Basics capture still clipped the typing line behind Continue. | Keyboard clearance was increased and the scaffold measures its distance from the window bottom for modal footer positioning. All five final native captures were visually re-reviewed. The wrapped description and seven-line reference text are fully visible, and their actions meet the keyboard. |
| P3: Selected tabs were absent from the web accessibility tree, and Edit retained a New workflow header. | Explicit `aria-selected` is present on destination and library tabs; the edit header now follows the route's operation. Library selection was rechecked in the browser. |

The independent launch/recovery review also drove the retained-request storage/race fixes and independent per-machine history loading documented in [the validation report](README.md). Those behavioral checks are recorded separately from this visual review.

## Coverage and limits

- Browser interactions used installed Chrome at 390×844 and desktop layouts at 1440×1000. The reviewer verified navigation, experimental gating, wizard progression, agent configuration, validation, review, and opening a saved workflow for launch. The review draft was not saved and this reviewer did not start a provider run.
- Native evidence is from the iPhone 17 Pro simulator running iOS 26.1. No physical iPhone, Android device, Android emulator, or external keyboard was tested in this review. The native captures validate keyboard layout; the actual completed provider run was exercised through the browser and real services.
- The final launch recheck had no rendering exceptions. Requests to the optional development log collector at `localhost:8787/logs` failed because that collector was absent; API/RPC traffic was not the source of those failures.
- The floating gear in native captures belongs to the Expo development client. The deliberately edited project-path text is keyboard evidence and was not used to start a native run.
- All validation used isolated development fixtures. This review does not claim that the change is deployed to production. Full test counts, execution results, and reproducible commands are in [README.md](README.md).
