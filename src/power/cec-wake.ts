import type { CecWakeConfig, CecWakeFailureBehavior, ConnectionState } from '../types';

export const DEFAULT_CEC_POWER_TO_HOME_DELAY_MS = 1_500;
export const DEFAULT_CEC_CONFIRMATION_TIMEOUT_SECONDS = 30;

export interface ResolvedCecWakeConfig {
  helperDeviceId: string;
  powerToHomeDelayMs: number;
  confirmationTimeoutMs: number;
  failureBehavior: CecWakeFailureBehavior;
}

export interface CecWakeRoute {
  name: string;
  dispatch(): Promise<void>;
}

export type CecWakeAttemptResult = 'online' | 'unavailable' | 'failed' | 'timeout';

export function isCecWakeHelperRouteAvailable(options: {
  paired: boolean;
  connection: ConnectionState;
  wakeOnLanEnabled: boolean;
  mac?: string;
}): boolean {
  return options.paired
    && (options.connection !== 'offline' || (options.wakeOnLanEnabled && Boolean(options.mac)));
}

export function resolveCecWakeConfig(config?: CecWakeConfig): ResolvedCecWakeConfig | undefined {
  const helperDeviceId = config?.helperDeviceId?.trim();
  if (!helperDeviceId) {
    return undefined;
  }
  const configuredDelay = config?.powerToHomeDelayMs;
  const configuredTimeout = config?.confirmationTimeoutSeconds;
  const powerToHomeDelayMs = Number.isFinite(configuredDelay)
    ? Math.max(0, Math.min(10_000, Math.round(configuredDelay!)))
    : DEFAULT_CEC_POWER_TO_HOME_DELAY_MS;
  const timeoutSeconds = Number.isFinite(configuredTimeout)
    ? Math.max(10, Math.min(120, Math.round(configuredTimeout!)))
    : DEFAULT_CEC_CONFIRMATION_TIMEOUT_SECONDS;
  return {
    helperDeviceId,
    powerToHomeDelayMs,
    confirmationTimeoutMs: timeoutSeconds * 1_000,
    failureBehavior: config?.failureBehavior === 'noResponse' ? 'noResponse' : 'remainOff',
  };
}

export async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (!condition()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return condition();
    }
    await new Promise<void>(resolve => {
      setTimeout(resolve, Math.min(intervalMs, remaining));
    });
  }
  return true;
}

export async function activateCecWakeHelper(options: {
  name: string;
  connection(): ConnectionState;
  stopped(): boolean;
  dispatchWakeOnLan?: () => Promise<void>;
  setPowerOn(): Promise<void>;
  sendHome(): Promise<void>;
  powerToHomeDelayMs: number;
  timeoutMs: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const startedAt = Date.now();
  if (options.connection() === 'offline') {
    if (!options.dispatchWakeOnLan) {
      throw new Error(`${options.name} is offline and has no usable Wake-on-LAN configuration`);
    }
    await options.dispatchWakeOnLan();
  }
  const online = await waitForCondition(
    () => options.stopped() || options.connection() === 'online',
    Math.max(0, options.timeoutMs - (Date.now() - startedAt)),
    options.pollIntervalMs,
  );
  if (options.stopped()) {
    throw new Error(`${options.name} stopped before CEC wake activation`);
  }
  if (!online || options.connection() !== 'online') {
    throw new Error(`${options.name} did not reconnect in time for CEC wake activation`);
  }
  await options.setPowerOn();
  if (options.powerToHomeDelayMs > 0) {
    await new Promise<void>(resolve => setTimeout(resolve, options.powerToHomeDelayMs));
  }
  await options.sendHome();
}

export async function runCecWakeAttempt(options: {
  routes: CecWakeRoute[];
  confirmationTimeoutMs: number;
  isTargetOnline(): boolean;
  onRouteFailure?(route: CecWakeRoute, error: unknown): void;
  pollIntervalMs?: number;
}): Promise<CecWakeAttemptResult> {
  if (options.routes.length === 0) {
    return 'unavailable';
  }
  const startedAt = Date.now();
  const results = await Promise.allSettled(options.routes.map(route => route.dispatch()));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      options.onRouteFailure?.(options.routes[index]!, result.reason);
    }
  });
  if (options.isTargetOnline()) {
    return 'online';
  }
  if (results.every(result => result.status === 'rejected')) {
    return 'failed';
  }
  const remaining = Math.max(0, options.confirmationTimeoutMs - (Date.now() - startedAt));
  return await waitForCondition(
    options.isTargetOnline,
    remaining,
    options.pollIntervalMs,
  ) ? 'online' : 'timeout';
}
