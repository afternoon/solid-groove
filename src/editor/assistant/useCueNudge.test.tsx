import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Analytics } from "../../analytics/analytics";
import { ConsentStore } from "../../analytics/consent";
import { createRecordingTransport } from "../../analytics/transport";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { localDay } from "../../memory/nudge";
import { useProducerProfile } from "../../memory/useProducerProfile";
import { InMemoryProfileRepository } from "../../persistence/inMemoryProfileRepository";
import { emptyProfile, type ProducerProfile } from "../../persistence/profileDocuments";
import { clickAndFlush } from "../../testing/events";
import { createFakeAssistantClient } from "../../testing/fakeAssistantClient";
import { memoryStorage } from "../../testing/storage";
import type { EditorViewName } from "../editorViews";
import { NUDGE_LABEL } from "./AssistantChatView";
import AssistantPanel from "./AssistantPanel";
import { DEFAULT_LAYOUT, float, saveLayout } from "./assistantPanelLayout";
import { useAssistantChat } from "./useAssistantChat";
import { useAssistantPanel } from "./useAssistantPanel";
import { nudgeMessage } from "./useCueNudge";

afterEach(cleanup);

const UID = "user-1";
const DAY = 86_400_000;

function onboarded(extra: Partial<ProducerProfile> = {}): ProducerProfile {
  return {
    ...emptyProfile(Date.now() - DAY),
    onboarding: "completed",
    onboardedAt: Date.now() - DAY,
    memory: { ...emptyProfile(1).memory, goal: "first_track" },
    ...extra,
  };
}

async function renderEditorChat(profile: ProducerProfile, open = true) {
  const client = createFakeAssistantClient();
  const transport = createRecordingTransport();
  const analytics = new Analytics({
    transport,
    consent: new ConsentStore(memoryStorage()),
    storage: memoryStorage(),
  });
  const profiles = new InMemoryProfileRepository();
  await profiles.saveProfile(UID, profile);
  const project = createSliceFixtureProject();
  const [view] = createSignal<EditorViewName>("arrangement");
  const Harness = () => {
    const storage = memoryStorage();
    if (open) saveLayout(float(DEFAULT_LAYOUT), storage);
    const panel = useAssistantPanel({ storage, analytics: () => analytics });
    const store = useProducerProfile({
      uid: () => UID,
      repository: async () => profiles,
    });
    const chat = useAssistantChat({
      project: () => project,
      view,
      sources: () => ({ selection: null, track: project.song.tracks[0] ?? null }),
      account: () => ({ registered: true }),
      expanded: () =>
        panel.layout().mode === "floating" || panel.layout().mode === "docked",
      client: async () => client,
      analytics: () => analytics,
      profile: store,
    });
    return <AssistantPanel panel={panel} chat={chat} />;
  };
  render(() => <Harness />);
  return { client, transport, profiles };
}

describe("Cue's daily nudge (GRV-25)", () => {
  it("is not offered on the day of onboarding", async () => {
    const { transport } = await renderEditorChat(onboarded({ onboardedAt: Date.now() }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("region", { name: NUDGE_LABEL })).not.toBeInTheDocument();
    expect(transport.named("cue_nudge_shown")).toHaveLength(0);
  });

  it("offers a first lesson to a returning producer, once a day, and records the day", async () => {
    const yesterday = Date.now() - DAY;
    const { transport, profiles } = await renderEditorChat(
      onboarded({ onboardedAt: yesterday }),
    );
    const nudge = await screen.findByRole("region", { name: NUDGE_LABEL });
    expect(nudge).toHaveTextContent('Want to try "Make your first beat"?');
    expect(transport.named("cue_nudge_shown")).toHaveLength(1);
    await waitFor(async () => {
      const loaded = await profiles.loadProfile(UID);
      expect(loaded.ok && loaded.profile?.lastNudgeDay).toBe(localDay(Date.now()));
    });
  });

  it("asks Cue for it on Let's try it", async () => {
    const { client, transport } = await renderEditorChat(
      onboarded({ onboardedAt: Date.now() - DAY }),
    );
    const nudge = await screen.findByRole("region", { name: NUDGE_LABEL });
    clickAndFlush(within(nudge).getByRole("button", { name: "Let's try it" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.last().request.messages.at(-1)?.text).toBe(
      nudgeMessage("Make your first beat"),
    );
    expect(screen.queryByRole("region", { name: NUDGE_LABEL })).not.toBeInTheDocument();
    expect(transport.named("cue_nudge_answered")[0]?.params.how).toBe("tried");
  });

  it("goes away on Not today, and is not offered again that day", async () => {
    const { transport } = await renderEditorChat(
      onboarded({ onboardedAt: Date.now() - DAY }),
    );
    const nudge = await screen.findByRole("region", { name: NUDGE_LABEL });
    clickAndFlush(within(nudge).getByRole("button", { name: "Not today" }));
    expect(screen.queryByRole("region", { name: NUDGE_LABEL })).not.toBeInTheDocument();
    expect(transport.named("cue_nudge_answered")[0]?.params.how).toBe("dismissed");
    cleanup();

    await renderEditorChat(
      onboarded({ onboardedAt: Date.now() - DAY, lastNudgeDay: localDay(Date.now()) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("region", { name: NUDGE_LABEL })).not.toBeInTheDocument();
  });

  it("is not offered when the project opens with the panel closed", async () => {
    await renderEditorChat(onboarded({ onboardedAt: Date.now() - DAY }), false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByRole("region", { name: NUDGE_LABEL })).not.toBeInTheDocument();
  });
});
