export type SessionRecording = {
  channelId: string;
  name: string;
  size: number;
  createdAt: string;
};

export type BroadcasterChannelStream = {
  channelId: string;
  channelName: string;
  stream: MediaStream;
};

export type ActiveChannelRecorder = {
  channelId: string;
  channelName: string;
  recorder: MediaRecorder;
  chunks: Blob[];
  done: Promise<void>;
  resolveDone: () => void;
};

