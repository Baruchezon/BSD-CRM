// Supabase Edge Function: forgot-password - DISABLED 02.10.2026 (security fix, approved by Baruch Ezon)
//
// The previous version (v29, backed up outside the repo) reset ANY email's password to a fixed
// value with no authentication. That flow is permanently disabled. This stub never reads or
// writes any user data and never changes a password. Password resets are done by an admin
// (users.html -> admin-set-password) or via Supabase Auth's built-in resetPasswordForEmail.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return new Response(
    JSON.stringify({ error: 'disabled', message: 'איפוס סיסמה עצמי הושבת. לאיפוס סיסמה יש לפנות למנהל המערכת.' }),
    { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
