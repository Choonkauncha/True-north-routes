/** Only the newest authorized day request may update the Shifts screen. */
export function createShiftDayLoader({ fetchDay, isAuthorized, onLoading, onSuccess, onError }) {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    async load(date) {
      const ticket = ++generation;
      const current = () => ticket === generation && isAuthorized();
      if (!current()) return;
      onLoading(date);
      try {
        const data = await fetchDay(date);
        if (current()) onSuccess(data, date);
      } catch (error) {
        if (current()) onError(error, date);
      }
    }
  };
}
