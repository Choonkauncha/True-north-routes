export default {
  async fetch(request) {
    const url = process.env.SUPABASE_URL || '';
    const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const adminEmails = (process.env.ADMIN_EMAILS || 'truenorthrestorationss@gmail.com,travisbishopmackie@gmail.com')
      .split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
    const origin = new URL(request.url).origin;
    return new Response(JSON.stringify({
      configured: Boolean(url && publishableKey),
      url, publishableKey, adminEmails,
      homeownerFormUrl: `${origin}/homeowner.html`,
      setterFormUrl: `${origin}/setter.html`
    }), {headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
};
