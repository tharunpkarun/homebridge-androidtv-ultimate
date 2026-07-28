import type { AppInputConfig } from '../types';
import { isAndroidPackageName, normalizePackageName } from './input-mapping';

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export type InputTestCommand =
  | { kind: 'uri'; uri: string; expectedPackage?: string }
  | { kind: 'keyCode'; keyCode: number; expectedPackage?: string };

export type InputTestConfirmation = 'matched' | 'different' | 'observed' | 'unconfirmed';

export interface InputTestResult {
  sent: true;
  command: InputTestCommand['kind'];
  confirmation: InputTestConfirmation;
  expectedPackage?: string;
  observedPackage?: string;
  testedAt: string;
}

export function validateInputTestCommand(input?: Partial<AppInputConfig>): InputTestCommand {
  const uri = typeof input?.uri === 'string' ? input.uri.trim() : undefined;
  const keyCode = input?.keyCode;
  const hasKeyCode = keyCode !== undefined && keyCode !== null;
  if (uri && hasKeyCode) {
    throw new Error('Choose either an app/deep-link command or an Android key command');
  }
  const configuredPackage = typeof input?.packageName === 'string'
    ? normalizePackageName(input.packageName)
    : undefined;
  if (configuredPackage && !isAndroidPackageName(configuredPackage)) {
    throw new Error('Active Android package must be a valid package ID');
  }
  if (hasKeyCode) {
    if (!Number.isInteger(keyCode) || keyCode! < 0 || keyCode! > 1000) {
      throw new Error('Android key code must be a whole number from 0 to 1000');
    }
    return { kind: 'keyCode', keyCode: keyCode!, expectedPackage: configuredPackage };
  }
  if (!uri) {
    throw new Error('Enter an app package, deep link, URI, or Android key code');
  }
  const packageCommand = isAndroidPackageName(uri);
  if (!packageCommand && !URI_SCHEME_PATTERN.test(uri)) {
    throw new Error('App commands must be a package ID or a URI with a scheme');
  }
  return {
    kind: 'uri',
    uri,
    expectedPackage: configuredPackage ?? (packageCommand ? uri : undefined),
  };
}

export function inputTestResult(
  command: InputTestCommand,
  observedPackage?: string,
  testedAt = new Date().toISOString(),
): InputTestResult {
  const observed = isAndroidPackageName(observedPackage) ? normalizePackageName(observedPackage) : undefined;
  const expected = command.expectedPackage;
  const confirmation: InputTestConfirmation = expected && observed === expected
    ? 'matched'
    : expected && observed
      ? 'different'
      : !expected && observed
        ? 'observed'
        : 'unconfirmed';
  return {
    sent: true,
    command: command.kind,
    confirmation,
    expectedPackage: expected,
    observedPackage: observed,
    testedAt,
  };
}
