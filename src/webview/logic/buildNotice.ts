// The build section's notice and button state. Kept free of React and the DOM
// so the host test suite can run it.

/** Whether the page has received the configuration yet. */
export type ConfigState = 'loading' | 'loaded';

/** The line shown above the build buttons (none when null) and whether the buttons can be pressed. */
export interface BuildNotice {
  text: string | null;
  buttonsEnabled: boolean;
}

export function buildNotice(configState: ConfigState): BuildNotice {
  if (configState === 'loading') {
    return { text: null, buttonsEnabled: false };
  }
  return { text: 'Builds the project of the active file, or one you choose.', buttonsEnabled: true };
}
