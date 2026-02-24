export type BroadcastLogRow = {
  sessionId: string;
  sessionName: string;
  startedAt: string;
  stoppedAt: string | null;
  isLive: boolean;
};

