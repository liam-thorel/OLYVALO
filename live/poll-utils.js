function createExclusivePoller(task, onError = () => {}) {
  let running = false;

  return async function runExclusivePoll(...args) {
    if (running) return false;
    running = true;
    try {
      await task(...args);
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      running = false;
    }
  };
}

module.exports = { createExclusivePoller };
