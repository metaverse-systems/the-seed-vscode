// Text of the add-resource form. Kept free of React and the DOM so the host test suite can run it.

/** The label before the name of the file chosen with the picker; it ends in the space that separates it from the name. */
export const SELECTED_FILE_LABEL = 'Selected file: ';

/** What the section says when it works on no resource pak; `choices` is how many the open folder holds. */
export function resourcePakHint(choices: number): string {
  if (choices > 1) {
    return `${choices} ResourcePaks found in the open folder. Choose the one to work on.`;
  }
  return 'No ResourcePak detected in the open folder. Create one from the Templates section, or choose one.';
}
