/** Auth notifications hold Supabase's auth lock. Database work must start later. */
export function createDeferredAuthHandler({ initialSession = null, onInvalidate = () => {}, onSession, onError = console.error, defer = task => setTimeout(task, 0) }) {
  let revision = 0;
  let userId = initialSession?.user?.id || null;
  return (event, session) => {
    const nextId = session?.user?.id || null;
    const ticket = ++revision;
    const current = () => ticket === revision;
    if (nextId !== userId || event === 'SIGNED_OUT') onInvalidate(event, session);
    userId = nextId;
    if (!session) return;
    defer(() => {
      if (!current()) return;
      Promise.resolve().then(() => onSession(session, current)).catch(error => {
        if (current()) onError(error);
      });
    });
  };
}
