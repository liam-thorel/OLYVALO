// Keep user choices outside the DOM: history cards are rebuilt on refresh/navigation.
export function createHistoryDisclosureState(attribute) {
  const opened = new Set();
  let previous = [];
  let generation = 0;
  const remember = element => {
    const id = element.getAttribute(attribute);
    if (!id) return;
    if (element.open) opened.add(id);
    else opened.delete(id);
  };
  return {
    restore(root) {
      // Capture even a toggle whose asynchronous event has not fired yet.
      previous.forEach(remember);
      const currentGeneration = ++generation;
      previous = [...root.querySelectorAll(`details[${attribute}]`)];
      previous.forEach(element => {
        element.addEventListener('toggle', () => {
          if (generation === currentGeneration) remember(element);
        });
        // Set after detail-loading listeners are attached, so reopening also
        // loads the match body through the existing pager/cache.
        element.open = opened.has(element.getAttribute(attribute));
      });
    },
  };
}
