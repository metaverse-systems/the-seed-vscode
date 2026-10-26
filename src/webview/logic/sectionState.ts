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

// The page's saved state (the webview state API) keeps what the user set, by section title, so a
// section stays as they left it when the view is hidden and shown again. Other keys are left alone.

function savedSections(saved: unknown): Record<string, boolean> {
  const sections = (saved as { sections?: unknown } | null | undefined)?.sections;
  return sections !== null && typeof sections === 'object' ? sections as Record<string, boolean> : {};
}

/** The section `title` as the saved state left it, or untouched at its default when the user never set it. */
export function restoreSection(saved: unknown, title: string, defaultCollapsed: boolean): SectionState {
  const collapsed = savedSections(saved)[title];
  return typeof collapsed === 'boolean' ? { collapsed, userSet: true } : initialSection(defaultCollapsed);
}

/** The saved state after `section` changed; a section the user has not set is not kept. */
export function saveSection(saved: unknown, title: string, section: SectionState): unknown {
  const base = saved !== null && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  const sections = { ...savedSections(saved) };
  if (section.userSet) {
    sections[title] = section.collapsed;
  } else {
    delete sections[title];
  }
  return { ...base, sections };
}
