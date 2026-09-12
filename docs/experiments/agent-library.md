# Experimental agent library

First increment: reusable identities, instructions and direct sessions. Disabled by default.

Enable **Settings → Features → Experimental Features → Agent library**. Then open **Settings → Agent library**, or choose the library from the new-session screen. Both switches are required, including for direct links.

Users can create, edit, duplicate and delete agents, or customize the Atlas, Iris and Forma templates. The wizard includes a name, description, icon, specialties, instructions, Markdown/text attachments, runtime, model, reasoning effort and permissions. Model/effort options come from one selected online machine's real provider catalog. A session launch revalidates the configuration against the launch machine; it never substitutes a different model or effort silently.

This increment supports Codex and Claude. Specialties are descriptions of focus, not verified tool capabilities. Browser/vision/image-generation capability matching, tool grants, automatic delegation, workflow execution, shared agent discovery, persistent agent memory and collective planning/review are future increments. The UI makes these boundaries explicit.

## Persistence and compatibility

- Definitions live in the existing encrypted account-settings sync as `agentLibrary`. The individual `expAgentLibrary` flag also syncs using that mechanism.
- Each launch saves a deep, versioned definition copy into encrypted session metadata as `agentProfile` before delivering the first task. Raw metadata and provider-specific fields survive optimistic-concurrency retries.
- Every app message carries the snapshot instructions through the existing `appendSystemPrompt` provider path. Model, effort and permission metadata use the session snapshot as their fallback, ahead of mutable global defaults. Users can still explicitly override a session's controls.
- Editing/deleting a library definition, or disabling the experiment, does not remove existing session snapshots. Resuming from another app device uses the same snapshot. This is configuration persistence, not an additional agent memory system.
- Saving an edit detects a definition that changed in the local store while its editor was open. Account settings use the existing whole-field sync/merge behavior: simultaneous offline edits to different agents are not a collaborative merge system. Do not present this as a shared multi-user registry.
- Definitions allow five instruction files, at most 16,000 characters each, and 24,000 characters of main instructions. The library has a 128,000 serialized-character budget and at most 100 agents, leaving space for encrypted account settings.
- Session launch retains the newly created session ID if profile persistence fails, offers an open-session link, and reuses that session on retry. The draft task remains until successful send. No automatic release, npm publication or production migration is part of this increment.

## Validation

See [browser/service evidence](../evidence/agent-library/README.md). Native UI uses shared React Native components, but this increment was exercised in desktop and phone-sized Chromium, not on an iOS/Android simulator.
