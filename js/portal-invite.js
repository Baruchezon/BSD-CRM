// Seller portal invitation text (WhatsApp / email). Shared by the business card
// and the portal management screen. Contains a one-time activation link only,
// never a password.
(()=>{'use strict';
const SITE='www.bsd-bbi.co.il';
function when(v){try{return new Date(v).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch{return '';}}
function message(d){
 const name=String(d.name||'').trim();
 const lines=[
  `שלום${name?' '+name:''},`,
  'תודה על האמון ועל שיתוף הפעולה. אנחנו ב-BSD מלווים אותך לאורך כל תהליך מכירת העסק.',
  'פתחנו עבורך אזור אישי מאובטח, שבו אפשר לצפות במסמכים, בהתאמות ובעדכונים של העסק שלך.',
  '',
  'הפעלת החשבון (פעם אחת בלבד):',
  `1. לוחצים על הקישור האישי: ${d.activation_url}`,
  '2. בוחרים סיסמה אישית (לפחות 10 תווים, עם אותיות ומספרים).',
  `הקישור אישי, פועל פעם אחת בלבד ותקף עד ${when(d.activation_expires_at)}. נא לא להעביר אותו לאחרים.`,
  '',
  'בכניסות הבאות:',
  `נכנסים לאתר ${SITE}, לוחצים בראש העמוד על הכפתור הכחול «פורטל בעלי עסקים» (לא VIP ולא CRM), ומתחברים עם שם המשתמש ${d.username} והסיסמה שבחרת.`,
  `אפשר גם להיכנס ישירות: ${d.portal_url}`,
  '',
  `לכל שאלה נשמח לעזור${d.contact_phone?' בטלפון '+d.contact_phone:''}.`,
  'בברכה,',
  'צוות BSD',
  'מחברים עסקים להזדמנויות'
 ];
 return lines.join('\n');
}
const subject='האזור האישי שלך ב-BSD: הפעלת החשבון';
function waNumber(phone){const n=String(phone||'').replace(/\D/g,'');return n.startsWith('0')?'972'+n.slice(1):n;}
function waUrl(d){const n=waNumber(d.phone);return /^972\d{8,9}$/.test(n)?'https://wa.me/'+n+'?text='+encodeURIComponent(message(d)):'';}
function mailUrl(d){const e=String(d.email||'').trim();return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e)?'mailto:'+encodeURIComponent(e)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(message(d)):'';}
window.BSDPortalInvite={message,subject,waNumber,waUrl,mailUrl};
})();
