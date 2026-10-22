export type Capability = 'native-component' | 'posix-toolchain';

const CAPABILITIES: Record<Capability, { reason: string; lackingOn: readonly string[] }> = {
  'native-component': {
    reason: "the tool's native component is not built on Windows",
    lackingOn: ['win32'],
  },
  'posix-toolchain': {
    reason: 'runs a POSIX shell and the Linux build toolchain, which Windows does not have',
    lackingOn: ['win32'],
  },
};

export function isLacking(capability: Capability, platform: string = process.platform): boolean {
  return CAPABILITIES[capability].lackingOn.includes(platform);
}

/**
 * Call inside a `suite` body. Where the capability is lacking, each case is
 * skipped and the skip is recorded for the reporter as a platform skip.
 */
export function requires(capability: Capability): void {
  setup(function (this: Mocha.Context) {
    if (isLacking(capability)) {
      const current = this.currentTest as (Mocha.Test & { platformSkip?: { capability: string; reason: string } }) | undefined;
      if (current) {
        current.platformSkip = { capability, reason: CAPABILITIES[capability].reason };
      }
      this.skip();
    }
  });
}

/** Runs the `win32` assertions on Windows and the `other` ones elsewhere. */
export function onPlatform(handlers: { win32: () => void | Promise<void>; other: () => void | Promise<void> }): void | Promise<void> {
  return process.platform === 'win32' ? handlers.win32() : handlers.other();
}
