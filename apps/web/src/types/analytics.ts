export type AnalyticsV2Session = {
  sessionId: string;
  sessionName: string;
  summary: {
    joinEvents: number;
    leaveEvents: number;
    consumeEvents: number;
    uniqueListeners: number;
    medianListeningDurationSec: number;
    p95ListeningDurationSec: number;
    bounceRate: number;
    averageListeningDurationSec: number;
    peakMetricValue: number;
  };
  series: Array<{ ts: number; value: number }>;
};

export type AnalyticsV2Response = {
  from: string;
  to: string;
  metric: string;
  granularity: "10s" | "1m" | "15m";
  sessions: AnalyticsV2Session[];
  ranking?: Array<{
    sessionId: string;
    sessionName: string;
    peakMetricValue: number;
    joinEvents: number;
    uniqueListeners: number;
  }>;
};

