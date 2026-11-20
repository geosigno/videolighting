/** Copy a textarea's content, also on a phone opened over http://<ip> (no secure context). */

const FEEDBACK_MS = 4000;

/** Legacy copy for non-secure contexts. */
function legacyCopy(area: HTMLTextAreaElement): boolean {
  // iOS only selects text in an editable, focused field, with an explicit range.
  area.readOnly = false;
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  // execCommand is deprecated but the only copy API outside secure contexts.
  const copied = document.execCommand("copy");
  area.readOnly = true;
  area.blur();
  return copied;
}

export async function copyText(
  area: HTMLTextAreaElement,
  button: HTMLElement,
  label: string
): Promise<void> {
  let message = "Copié ✓";
  try {
    await navigator.clipboard.writeText(area.value);
  } catch {
    // The Clipboard API needs a secure context: fall back to the legacy path.
    if (!legacyCopy(area)) {
      area.readOnly = false;
      area.setSelectionRange(0, area.value.length);
      message = "Sélectionné : appuie longuement dessus puis « Copier »";
    }
  }
  button.textContent = message;
  setTimeout(() => {
    button.textContent = label;
  }, FEEDBACK_MS);
}
