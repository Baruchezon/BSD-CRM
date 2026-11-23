// Display only: snapshots come from database triggers and never confer access.
(function(root){
  const clean=value=>String(value??'').trim();
  const escape=value=>clean(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sources={website:'אתר',facebook:'פייסבוק',phone:'טלפון',our_link:'קישור הרשמה',call:'טלפון',manual:'הזנה ידנית',invited_by_baruch:'הזמנה של ברוך',invited_by_agent:'הזמנה של סוכן',vip:'VIP'};
  function text(row){
    if(!row)return 'מקור לא תועד';
    if(row._anonymous||row._anon_scope)return 'פרטי המקור שמורים להנהלת BSD';
    const ref=clean(row.referred_by_agent_name),entered=clean(row.origin_entered_by_name);
    const raw=clean(row.original_source)||clean(row.source),source=sources[raw]||raw;
    const who=ref?'הובא על ידי: '+ref:entered?'הוזן על ידי: '+entered:'';
    return [who,source?'מקור: '+source:''].filter(Boolean).join(' · ')||'מקור לא תועד';
  }
  function html(row){const label=text(row);return '<small class="bsd-record-origin" style="display:block;font-size:14px;line-height:1.45;font-weight:400;color:inherit;white-space:normal;overflow-wrap:anywhere" title="מקור ההגעה המקורי">'+escape(label)+'</small>';}
  root.BSDOrigin={text,html};
})(typeof window==='undefined'?globalThis:window);
