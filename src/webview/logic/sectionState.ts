// Whether a sidebar section is folded. Kept free of React and the DOM so the
// host test suite can run it.

/** A section's folding, and whether the user has set it. */
export interface SectionState {
  collapsed: boolean;
  userSet: boolean;
}

/** The user's click or key on the header, or a new default from the page. */
export type SectionEvent = { kind: 'toggle' } | { kind: 'default'; collapsed: boolean };

/** A section that starts at its default and has not been touched. */
export function initialSection(defaultCollapsed: boolean): SectionState {
  return { collapsed: defaultCollapsed, userSet: false };
}

/** The section after `event`. */
export function nextSection(state: SectionState, event: SectionEvent): SectionState {
  if (event.kind === 'toggle') {
    return { collapsed: !state.collapsed, userSet: true };
  }
  // Once the user has folded or unfolded the section, a new default leaves it as it is.
  if (state.userSet) {
    return state;
  }
  return { collapsed: event.collapsed, userSet: false };
}
