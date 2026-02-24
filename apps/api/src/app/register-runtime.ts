import { registerSocketRealtime } from "../realtime/socket";
import { registerJoinRoutes } from "../routes/join-routes";
import { registerPublicRoutes } from "../routes/public-routes";
import { registerAdminAuthRoutes } from "../routes/admin-auth-routes";
import { registerAdminUsersRoutes } from "../routes/admin-users-routes";
import { registerAdminSessionsRoutes } from "../routes/admin-sessions-routes";
import { registerAnalyticsRoutes } from "../routes/analytics-routes";
import { registerRecordingRoutes } from "../routes/recordings-routes";
import { registerPreShowTracksRoutes } from "../routes/preshow-tracks-routes";
import { registerSessionChannelsRoutes } from "../routes/session-channels-routes";
import { registerDebugTestsRoutes } from "../routes/debug-tests-routes";
import { buildAnalyticsV2 as buildAnalyticsV2Raw, findActiveSessionByCode as findActiveSessionByCodeRaw } from "../services/analytics-v2";
import { parseAnalyticsWindow, recordAnalyticsPoint as recordAnalyticsPointRaw, recordAnalyticsPoints as recordAnalyticsPointsRaw, cleanupAnalyticsRawData as cleanupAnalyticsRawDataRaw } from "../services/analytics-record";
import { buildSessionAnalytics as buildSessionAnalyticsRaw, fetchLiveChannelIds as fetchLiveChannelIdsRaw, fetchSessionStats as fetchSessionStatsRaw, markSessionStatsSinceNow as markSessionStatsSinceNowRaw, toCsvValue } from "../services/session-analytics";

export function registerRuntime(deps: any): {
  bootstrapTimescaleIfAvailable: () => Promise<void>;
} {
  const {
    app,
    io,
    prisma,
    IS_TEST_ENV,
    MEDIA_BASE_URL,
    SESSION_STATS_SINCE_PREFIX,
    ANALYTICS_RAW_RETENTION_DAYS,
    ANALYTICS_MAX_COMPARE_SESSIONS,
    detectLanIp,
    validateCodeSchema,
    adminLoginSchema,
    changeAdminPasswordSchema,
    updateAppLogoSchema,
    createAdminUserSchema,
    updateAdminUserSchema,
    updateSessionUserAccessSchema,
    createRecordingSchema,
    createSessionSchema,
    updateSessionSchema,
    createChannelSchema,
    createJoinLinkSchema,
    analyticsV2QuerySchema,
    joinLimiter,
    liveStateLimiter,
    adminLoginLimiter,
    attempts,
    listenerSocketsBySession,
    broadcasterSocketsBySession,
    listenerStateBySocket,
    liveListenerCountsBySessionChannel,
    sessionLiveSeries,
    getLiveListenerChannelCounts,
    getLiveListenerTotal,
    isListenerAuth,
    addSocketToRoleMap,
    removeSocketFromRoleMap,
    changeLiveListenerCount,
    recordLiveSnapshot,
    clearSessionAnalyticsState,
    adminCore,
    buildJoinBaseUrl,
    detectLanIpFn,
    RECORDINGS_ROOT,
    ensureChannelRecordingsDir,
    listSessionRecordings,
    pruneChannelRecordings,
    safeRecordingName,
    transcodeWebmToMp3,
    bootstrapTimescaleIfAvailable
  } = deps;

  const {
    setAdminCookie,
    clearAdminCookie,
    decodeAdminWsJwt,
    readValidatedAdminFromCookieHeader,
    isSessionVersionCurrent,
    readAdminFromRequestCookie,
    getSessionVersion,
    bumpSessionVersion,
    hasSessionAccess,
    ensureSessionAccessOr404,
    getAccessibleSessionIds,
    resolveExistingUserId,
    requireAuthenticated,
    requireRoles,
    normalizeForLookup,
    buildPseudoEmailFromName,
    getEffectiveAdminPasswordHash,
    getEffectiveAdminLoginName,
    getAppLogoBranding,
    generateUniqueSessionCode
  } = adminCore;

  const recordAnalyticsPoint = (input: { sessionId: string; metric: string; value: number; channelId?: string; ts?: Date }) => recordAnalyticsPointRaw(prisma, input);
  const recordAnalyticsPoints = (points: Array<{ sessionId: string; metric: string; value: number; channelId?: string; ts?: Date }>) => recordAnalyticsPointsRaw(prisma, points);
  const cleanupAnalyticsRawData = () => cleanupAnalyticsRawDataRaw(prisma, ANALYTICS_RAW_RETENTION_DAYS);
  const markSessionStatsSinceNow = (sessionId: string) => markSessionStatsSinceNowRaw(prisma, SESSION_STATS_SINCE_PREFIX, sessionId);
  const fetchSessionStats = (sessionId: string) =>
    fetchSessionStatsRaw({ prisma, MEDIA_BASE_URL, SESSION_STATS_SINCE_PREFIX, listenerSocketsBySession, broadcasterSocketsBySession, getLiveListenerChannelCounts, getLiveListenerTotal, sessionLiveSeries }, sessionId);
  const fetchLiveChannelIds = (sessionId: string) => fetchLiveChannelIdsRaw(MEDIA_BASE_URL, sessionId);
  const getBroadcastOwner = (sessionId: string) => deps.getBroadcastOwner(sessionId);
  const getSessionLiveMode = (sessionId: string) => deps.getSessionLiveMode(sessionId);
  const setSessionLiveMode = (sessionId: string, mode: "none" | "mic" | "preshow" | "testtone") => deps.setSessionLiveMode(sessionId, mode);
  const clearSessionLiveMode = (sessionId: string) => deps.clearSessionLiveMode(sessionId);
  const forceBroadcastTakeover = async (sessionId: string): Promise<void> => {
    const socketIds = Array.from((broadcasterSocketsBySession.get(sessionId) ?? new Set<string>()).values());
    for (const socketId of socketIds) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.disconnect(true);
    }
    deps.clearBroadcastOwner(sessionId);
  };
  const buildSessionAnalytics = (sessionId: string) =>
    buildSessionAnalyticsRaw({ prisma, MEDIA_BASE_URL, SESSION_STATS_SINCE_PREFIX, listenerSocketsBySession, broadcasterSocketsBySession, getLiveListenerChannelCounts, getLiveListenerTotal, sessionLiveSeries }, sessionId);
  const buildAnalyticsV2 = (input: { sessionIds: string[]; from: Date; to: Date; channelId?: string; metric: string; granularity: "10s" | "1m" | "15m" }) => buildAnalyticsV2Raw(prisma, input);
  const findActiveSessionByCode = (code: string) => findActiveSessionByCodeRaw(prisma, code);

  if (!IS_TEST_ENV) {
    setInterval(() => {
      const sessionIds = new Set<string>([
        ...(Array.from(listenerSocketsBySession.keys()) as string[]),
        ...(Array.from(liveListenerCountsBySessionChannel.keys()) as string[]),
        ...(Array.from(broadcasterSocketsBySession.keys()) as string[])
      ]);
      for (const sessionId of sessionIds) recordLiveSnapshot(sessionId);
      const now = new Date();
      for (const sessionId of sessionIds) {
        const listenersTotal = getLiveListenerTotal(sessionId);
        const broadcastersConnected = broadcasterSocketsBySession.get(sessionId)?.size ?? 0;
        const byChannel = getLiveListenerChannelCounts(sessionId);
        const points: Array<{ sessionId: string; metric: string; value: number; channelId?: string; ts?: Date }> = [
          { sessionId, metric: "listeners_total", value: listenersTotal, ts: now },
          { sessionId, metric: "broadcasters_connected", value: broadcastersConnected, ts: now }
        ];
        for (const [channelId, count] of Object.entries(byChannel)) points.push({ sessionId, channelId, metric: "listeners_channel", value: Number(count), ts: now });
        void recordAnalyticsPoints(points);
      }
    }, 10_000);
    setInterval(() => void cleanupAnalyticsRawData(), 60 * 60 * 1000);
  }

  registerPublicRoutes({ app, prisma, detectLanIp: detectLanIpFn ?? detectLanIp, getAppLogoBranding });
  registerJoinRoutes({ app, prisma, joinLimiter, liveStateLimiter, validateCodeSchema, attempts, findActiveSessionByCode, fetchLiveChannelIds });
  registerAdminAuthRoutes({
    app,
    prisma,
    requireAuthenticated,
    requireRoles,
    adminLoginLimiter,
    adminLoginSchema,
    changeAdminPasswordSchema,
    updateAppLogoSchema,
    normalizeForLookup,
    getEffectiveAdminLoginName,
    getEffectiveAdminPasswordHash,
    buildPseudoEmailFromName,
    setAdminCookie,
    clearAdminCookie,
    readAdminFromRequestCookie,
    getSessionVersion,
    bumpSessionVersion,
    ensureSessionAccessOr404,
    JWT_SECRET: deps.JWT_SECRET,
    JWT_ISSUER: deps.JWT_ISSUER,
    ADMIN_SESSION_TTL_HOURS: deps.ADMIN_SESSION_TTL_HOURS,
    ADMIN_WS_TOKEN_TTL_MINUTES: deps.ADMIN_WS_TOKEN_TTL_MINUTES,
    getDebugMode: deps.getDebugMode,
    canToggleDebugMode: deps.canToggleDebugMode,
    setDebugMode: deps.setDebugMode,
    APP_LOGO_CONFIG_KEY: deps.APP_LOGO_CONFIG_KEY,
    DEFAULT_APP_LOGO_URL: deps.DEFAULT_APP_LOGO_URL,
    ADMIN_PASSWORD_CONFIG_KEY: deps.ADMIN_PASSWORD_CONFIG_KEY
  });
  registerAdminUsersRoutes({ app, prisma, requireAuthenticated, requireRoles, createAdminUserSchema, updateAdminUserSchema, updateSessionUserAccessSchema, normalizeForLookup, buildPseudoEmailFromName });
  registerRecordingRoutes({
    app,
    prisma,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    createRecordingSchema,
    listSessionRecordings,
    ensureChannelRecordingsDir,
    transcodeWebmToMp3,
    pruneChannelRecordings,
    safeRecordingName,
    RECORDINGS_ROOT
  });
  registerPreShowTracksRoutes({
    app,
    prisma,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    createPreShowTrackSchema: deps.createPreShowTrackSchema,
    safeRecordingName,
    RECORDINGS_ROOT
  });
  registerAdminSessionsRoutes({
    app,
    prisma,
    io,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    createSessionSchema,
    updateSessionSchema,
    generateUniqueSessionCode,
    resolveExistingUserId,
    fetchSessionStats,
    fetchLiveChannelIds,
    getBroadcastOwner,
    forceBroadcastTakeover
  });
  registerAnalyticsRoutes({
    app,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    analyticsV2QuerySchema,
    parseAnalyticsWindow,
    buildAnalyticsV2,
    getAccessibleSessionIds,
    buildSessionAnalytics,
    toCsvValue,
    markSessionStatsSinceNow,
    clearSessionAnalyticsState,
    ANALYTICS_MAX_COMPARE_SESSIONS,
    prisma
  });
  registerSessionChannelsRoutes({ app, prisma, io, requireAuthenticated, requireRoles, ensureSessionAccessOr404, createSessionSchema, createChannelSchema, createJoinLinkSchema, generateUniqueSessionCode, resolveExistingUserId, buildJoinBaseUrl });
  registerDebugTestsRoutes({
    app,
    prisma,
    debugMode: deps.getDebugMode,
    debugTestManager: deps.debugTestManager,
    testToneWatchdogStore: deps.testToneWatchdogStore,
    getSessionLiveMode,
    MEDIA_BASE_URL,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    apiOrigin: deps.API_ORIGIN
  });
  registerSocketRealtime({
    io,
    prisma,
    MEDIA_BASE_URL,
    MEDIA_INTERNAL_TOKEN: deps.MEDIA_INTERNAL_TOKEN,
    decodeAdminWsJwt,
    readValidatedAdminFromCookieHeader,
    isSessionVersionCurrent,
    findActiveSessionByCode,
    hasSessionAccess,
    isListenerAuth,
    addSocketToRoleMap,
    removeSocketFromRoleMap,
    changeLiveListenerCount,
    recordLiveSnapshot,
    clearSessionAnalyticsState,
    markSessionStatsSinceNow,
    recordAnalyticsPoint,
    getBroadcastOwner,
    getSessionLiveMode,
    setSessionLiveMode,
    clearSessionLiveMode,
    setBroadcastOwner: deps.setBroadcastOwner,
    clearBroadcastOwner: deps.clearBroadcastOwner,
    getDebugMode: deps.getDebugMode,
    testToneWatchdogStore: deps.testToneWatchdogStore,
    listenerSocketsBySession,
    broadcasterSocketsBySession,
    listenerStateBySocket
  });

  return { bootstrapTimescaleIfAvailable: () => bootstrapTimescaleIfAvailable(prisma) };
}
