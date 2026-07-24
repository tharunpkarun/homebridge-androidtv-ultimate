import type { AppInputConfig, LearnedInputMapping } from '../types';

export interface InputPackageBinding {
  identifier: number;
  name: string;
  uri: string;
  packageName?: string;
  learnedPackageName?: string;
}

export interface InputPackageMatch {
  identifier: number;
  source: 'explicit' | 'learned' | 'uri';
}

export function normalizePackageName(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function isAndroidPackageName(value?: string): boolean {
  const normalized = normalizePackageName(value);
  return Boolean(normalized && /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(normalized));
}

export function assignInputIdentifiers(inputs: AppInputConfig[]): number[] {
  const used = new Set<number>();
  return inputs.map((input, index) => {
    let identifier = input.identifier ?? index + 1;
    while (used.has(identifier)) {
      identifier += 1;
    }
    used.add(identifier);
    return identifier;
  });
}

export function duplicateExplicitPackages(inputs: AppInputConfig[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const input of inputs) {
    const packageName = normalizePackageName(input.packageName);
    if (!packageName) {
      continue;
    }
    if (seen.has(packageName)) {
      duplicates.add(packageName);
    }
    seen.add(packageName);
  }
  return [...duplicates];
}

export function applyLearnedMappings(
  inputs: InputPackageBinding[],
  mappings: LearnedInputMapping[],
): void {
  const byIdentifier = new Map(mappings.map(mapping => [mapping.inputIdentifier, mapping.packageName]));
  for (const input of inputs) {
    input.learnedPackageName = byIdentifier.get(input.identifier);
  }
}

export function resolveInputMatch(inputs: InputPackageBinding[], currentApp?: string): InputPackageMatch | undefined {
  const packageName = normalizePackageName(currentApp);
  if (!packageName) {
    return undefined;
  }
  const explicit = inputs.find(input => normalizePackageName(input.packageName) === packageName);
  if (explicit) {
    return { identifier: explicit.identifier, source: 'explicit' };
  }
  const learned = inputs.find(input => normalizePackageName(input.learnedPackageName) === packageName);
  if (learned) {
    return { identifier: learned.identifier, source: 'learned' };
  }
  const uri = inputs.find(input => isAndroidPackageName(input.uri) && normalizePackageName(input.uri) === packageName);
  return uri ? { identifier: uri.identifier, source: 'uri' } : undefined;
}

export function resolveInputIdentifier(inputs: InputPackageBinding[], currentApp?: string): number {
  return resolveInputMatch(inputs, currentApp)?.identifier ?? 0;
}

export function inputNeedsLearning(input: InputPackageBinding): boolean {
  return !normalizePackageName(input.packageName)
    && !normalizePackageName(input.learnedPackageName)
    && !isAndroidPackageName(input.uri);
}

interface LearningSession {
  identifier: number;
  initialPackage?: string;
  foregroundChanged: boolean;
  candidate?: string;
  stableTimer?: NodeJS.Timeout;
  timeoutTimer: NodeJS.Timeout;
}

export class ActiveInputLearner {
  private session?: LearningSession;

  constructor(
    private readonly learned: (identifier: number, packageName: string) => void | Promise<void>,
    private readonly windowMs = 15_000,
    private readonly stableMs = 3_000,
  ) {}

  begin(identifier: number, currentApp?: string): void {
    this.cancel();
    const timeoutTimer = setTimeout(() => this.cancel(), this.windowMs);
    timeoutTimer.unref();
    this.session = {
      identifier,
      initialPackage: normalizePackageName(currentApp),
      foregroundChanged: false,
      timeoutTimer,
    };
  }

  observe(currentApp: string | undefined, knownIdentifier: number): void {
    const session = this.session;
    const packageName = normalizePackageName(currentApp);
    if (!session || !packageName || !isAndroidPackageName(packageName)) {
      return;
    }
    if (knownIdentifier !== 0) {
      this.cancel();
      return;
    }
    if (!session.foregroundChanged && packageName === session.initialPackage) {
      return;
    }
    session.foregroundChanged = true;
    if (session.candidate === packageName) {
      return;
    }
    if (session.stableTimer) {
      clearTimeout(session.stableTimer);
    }
    session.candidate = packageName;
    session.stableTimer = setTimeout(() => {
      if (this.session !== session || session.candidate !== packageName) {
        return;
      }
      const identifier = session.identifier;
      this.cancel();
      void this.learned(identifier, packageName);
    }, this.stableMs);
    session.stableTimer.unref();
  }

  cancel(): void {
    if (!this.session) {
      return;
    }
    clearTimeout(this.session.timeoutTimer);
    if (this.session.stableTimer) {
      clearTimeout(this.session.stableTimer);
    }
    this.session = undefined;
  }
}
