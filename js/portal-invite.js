// Seller portal invitation text (WhatsApp / email). Shared by the business card
// and the portal management screen. Since 04.10.2026 (v2) the message carries a
// username and a random password created by the server. The password exists
// only in this generated text; the server keeps a one-way hash. The seller is
// told to log in ONLY through the BSD website button.
(()=>{'use strict';
const SITE='www.bsd-bbi.co.il';
function message(d){
 const name=String(d.name||'').trim();
 return [
  `שלום${name?' '+name:''},`,
  'תודה על האמון ועל שיתוף הפעולה. אנחנו ב-BSD מלווים אותך לאורך כל תהליך מכירת העסק.',
  'פתחנו עבורך אזור אישי מאובטח, שבו אפשר לצפות במסמכים ובעדכונים של העסק שלך.',
  '',
  'איך נכנסים:',
  `1. נכנסים לאתר ${d.site||SITE}`,
  '2. לוחצים בראש העמוד על הכפתור הכחול «פורטל בעלי עסקים»',
  '3. מזינים את שם המשתמש והסיסמה:',
  `שם משתמש: ${d.username}`,
  `סיסמה: ${d.password}`,
  '',
  'הפרטים אישיים, נא לא להעביר אותם לאחרים. אפשר להחליף את הסיסמה בכל עת בתוך האזור האישי («החלפת סיסמה»).',
  '',
  `לכל שאלה נשמח לעזור${d.contact_phone?' בטלפון '+d.contact_phone:''}.`,
  'בברכה,',
  'צוות BSD',
  'מחברים עסקים להזדמנויות'
 ].join('\n');
}
const subject='האזור האישי שלך ב-BSD: פרטי כניסה';
function waNumber(phone){const n=String(phone||'').replace(/\D/g,'');return n.startsWith('0')?'972'+n.slice(1):n;}
function waUrl(d){const n=waNumber(d.phone);return /^972\d{8,9}$/.test(n)?'https://wa.me/'+n+'?text='+encodeURIComponent(message(d)):'';}
window.BSDPortalInvite={message,subject,waNumber,waUrl};
})();
