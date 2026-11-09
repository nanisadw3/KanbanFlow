// Gives pop-ups an EXIT animation without touching every component that renders them.
//
// React removes a closed dialog / toast from the DOM immediately, so CSS alone can't fade it out. This watches
// for those removals and puts the removed element back where it was, flagged `exit-ghost`: it plays its exit
// animation (see index.css), ignores the pointer and the keyboard, and is deleted when it ends. Only
// overlays that float above the page are handled (modals, toasts, the hover bubble): an in-flow element would
// leave a hole while it lingers.
//
// MutationObserver callbacks run before the next paint, so the element never flashes.

const SELECTOR = '.modal-overlay, .toast, .notes-bubble';
const EXIT_MS = 260;

export function installExitGhosts(): void {
  if (typeof MutationObserver === 'undefined' || typeof window === 'undefined') return;
  // People who asked for less motion get the plain, instant behaviour.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement) || !node.matches(SELECTOR) || node.classList.contains('exit-ghost')) continue;
        // The whole parent went away too (e.g. logout): there is nothing to animate in.
        if (!record.target.isConnected) continue;
        const next = record.nextSibling && record.nextSibling.parentNode === record.target ? record.nextSibling : null;
        node.classList.add('exit-ghost');
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('inert', '');
        record.target.insertBefore(node, next);
        window.setTimeout(() => node.remove(), EXIT_MS);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
