export default {
  async fetch() {
    const url = process.env.SUPABASE_URL || '';
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    return new Response(JSON.stringify({configured: Boolean(url && publishableKey), url, publishableKey}), {
      headers:{'content-type':'application/json','cache-control':'no-store'}
    });
  }
};
