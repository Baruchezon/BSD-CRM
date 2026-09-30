// The leads table also stores canonical buyer cards. Never delete a destination
// just because it also appeared in the temporary inbox.
(function(root){
  const open = l => l.website_intake_stage === 'new' || l.website_intake_stage === 'contacted';
  const isWebsite = l => /אתר|site123|website/i.test(l.source || '');
  function pending(leads, businesses){
    const linked = new Set(businesses.filter(b => b.seller_id).map(b => b.seller_id));
    return leads.filter(l => !l.is_archived && !linked.has(l.id) &&
      (open(l) || (l.type === 'seller' && !l.website_intake_stage)));
  }
  root.BSDLeadLifecycle = {open,isWebsite,pending};
})(typeof window === 'undefined' ? globalThis : window);
