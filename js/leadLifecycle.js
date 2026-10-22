// The leads table also stores canonical buyer cards. Never delete a destination
// just because it also appeared in the temporary inbox.
(function(root){
  const open = l => l.website_intake_stage === 'new' || l.website_intake_stage === 'contacted';
  const isWebsite = l => /אתר|site123|website/i.test(l.source || '');
  // Incoming EXM calls are inserted as buyers with source «שיחה טלפונית נכנסת»
  // and no website_intake_stage. They stay in the leads inbox until transfer.
  const phoneInbox = l => l.source === 'שיחה טלפונית נכנסת' && l.status !== 'הועבר לקונה' && l.status !== 'הועבר למוכר';
  function pending(leads, businesses){
    const linked = new Set(businesses.filter(b => b.seller_id).map(b => b.seller_id));
    return leads.filter(l => !l.is_archived && !l.crm_stage && !linked.has(l.id) &&
      (open(l) || phoneInbox(l) || (l.type === 'seller' && !l.website_intake_stage)));
  }
  root.BSDLeadLifecycle = {open,isWebsite,pending,phoneInbox};
})(typeof window === 'undefined' ? globalThis : window);
