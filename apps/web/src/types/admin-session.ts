export type AdminSessionSummary = {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  status: "ACTIVE" | "ENDED";
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  channelsCount: number;
  listenersConnected: number;
  activeProducerChannels: number;
};
