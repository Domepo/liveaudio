import { fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../stores/app";
import AdminSessionDetail from "../admin/AdminSessionDetail.svelte";

const broadcastMocks = vi.hoisted(() => ({
  startBroadcast: vi.fn<() => Promise<void>>(),
  stopBroadcast: vi.fn<() => Promise<void>>()
}));

vi.mock("../../controllers/broadcaster/broadcast", () => broadcastMocks);

const initialState = get(app);

function setReadyState(isBroadcasting = false): void {
  app.set({
    ...initialState,
    selectedSessionId: "session-1",
    sessionCode: "123456",
    channels: [{ id: "channel-1", name: "Deutsch", languageCode: "de" }],
    isBroadcasting,
    isPreshowMusicActive: false,
    isTestToneActive: false,
    debugMode: false
  });
}

describe("AdminSessionDetail live controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    broadcastMocks.startBroadcast.mockResolvedValue();
    broadcastMocks.stopBroadcast.mockResolvedValue();
    setReadyState();
  });

  it("separates navigation from the live action and hides music controls", () => {
    render(AdminSessionDetail);

    expect(screen.getByRole("tab", { name: "Steuerung" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Jetzt live gehen" })).toBeEnabled();
    expect(screen.queryByText("Musik")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto-Switch")).not.toBeInTheDocument();
  });

  it("starts the microphone broadcast exactly once even when clicked again while starting", async () => {
    let finishStart: (() => void) | undefined;
    broadcastMocks.startBroadcast.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishStart = resolve;
      })
    );
    render(AdminSessionDetail);

    const startButton = screen.getByRole("button", { name: "Jetzt live gehen" });
    void fireEvent.click(startButton);

    expect(broadcastMocks.startBroadcast).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Übertragung wird gestartet..." })).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "Übertragung wird gestartet..." }));
    expect(broadcastMocks.startBroadcast).toHaveBeenCalledTimes(1);

    finishStart?.();
    await Promise.resolve();
  });

  it("uses the same primary control to stop an active broadcast", async () => {
    setReadyState(true);
    render(AdminSessionDetail);

    await fireEvent.click(screen.getByRole("button", { name: "Live-Übertragung stoppen" }));

    expect(broadcastMocks.stopBroadcast).toHaveBeenCalledTimes(1);
    expect(broadcastMocks.startBroadcast).not.toHaveBeenCalled();
  });
});
