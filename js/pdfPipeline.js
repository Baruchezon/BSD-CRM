// ============================================================
// BSD CRM — צינור הפקת PDF משותף (html2canvas-pro + jsPDF)
// ------------------------------------------------------------
// תיקון שורש (26.08.2026): הצינור הקודם (html2pdf.js, שעוטף html2canvas
// הישן) שובר עברית מעורבת עם מספרים/אנגלית/מרכאות (למשל "בע"מ", "ח.פ.
// 123456789", טלפונים, משפטים באנגלית בתוך פסקה עברית) - נבדק בפועל על
// קובץ שהורד בפועל למחשב, לא רק בתצוגת דפדפן. html2canvas-pro (גרסה
// מתוחזקת עם תיקוני bidi) פותר את זה במלואו - נבדק ואומת מול אותו תוכן
// בדיוק. זהו החלפה נקודתית של שכבת ה"צילום" בלבד - שאר הארכיטקטורה
// (jsPDF להרכבת הקובץ, אותה תבנית HTML) זהה לגמרי לצינור הקיים.
// שימוש: אותו קוד משמש גם את match-detail.html (סיכומי פגישות) וגם את
// מודול התקצירים החדש בכרטיס העסק - אין שני מנגנוני PDF מקבילים.
// ============================================================

// טוען את html2canvas-pro ואת jsPDF מ-CDN פעם אחת בלבד, בכל דף שמשתמש בזה.
window.__bsdPdfLibsPromise = window.__bsdPdfLibsPromise || (async function loadPdfLibs(){
  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('טעינת ספריית PDF נכשלה: ' + src));
      document.head.appendChild(s);
    });
  }
  if (typeof window.html2canvas !== 'function'){
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.8/dist/html2canvas-pro.min.js');
  }
  if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function'){
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  }
})();

async function bsdNextPaint(){ await new Promise(r => requestAnimationFrame(()=>requestAnimationFrame(r))); }

// מצלם אלמנט DOM ומרכיב ממנו PDF רב-עמודים (A4), עם פיצול עמודים לפי
// גובה בפועל (כמו שה-html2pdf.js הקודם עשה) - כדי שתוכן ארוך (תקציר עסקי
// מלא) לא ייחתך/יידחס לעמוד אחד.
async function bsdRenderElementToPdf(el, opts){
  opts = opts || {};
  await window.__bsdPdfLibsPromise;
  await bsdNextPaint();
  if (typeof window.html2canvas !== 'function') throw new Error('html2canvas-pro לא נטען - בדוק חסימת רשת ל-CDN');

  let canvas, attempt = 1;
  while (true){
    canvas = await window.html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    if ((canvas.width < 10 || canvas.height < 10) && attempt < 4){ attempt++; await new Promise(r=>setTimeout(r,400*attempt)); continue; }
    break;
  }
  if (canvas.width < 10 || canvas.height < 10) throw new Error('הצילום יצא ריק לאחר ' + attempt + ' ניסיונות');

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const marginMm = 10;
  const pageWidthMm = pdf.internal.pageSize.getWidth();
  const pageHeightMm = pdf.internal.pageSize.getHeight();
  const usableWidthMm = pageWidthMm - marginMm * 2;
  const usableHeightMm = pageHeightMm - marginMm * 2;
  const pxPerMm = canvas.width / usableWidthMm;
  const pageHeightPx = Math.max(1, Math.floor(usableHeightMm * pxPerMm));
  const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

  for (let i = 0; i < totalPages; i++){
    const remaining = canvas.height - i * pageHeightPx;
    const sliceHeightPx = Math.min(pageHeightPx, remaining);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceHeightPx;
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, i * pageHeightPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
    const imgData = sliceCanvas.toDataURL('image/png');
    if (i > 0) pdf.addPage();
    const sliceHeightMm = sliceHeightPx / pxPerMm;
    pdf.addImage(imgData, 'PNG', marginMm, marginMm, usableWidthMm, sliceHeightMm);
  }

  const blob = pdf.output('blob');
  if (!blob || blob.size < 500) throw new Error('קובץ PDF פגום/קטן מדי');
  return { blob, pages: totalPages };
}

// ============================================================
// תבנית מותג BSD (לפי bsd-brand-template skill / master_template.html שאושר)
// ------------------------------------------------------------
// כותרת עליונה + פוטר נלכדים פעם אחת בלבד (זהים בכל עמוד חוץ ממספר העמוד,
// שהוא ספרות בלבד ולכן נכתב ישירות ב-jsPDF, לא דרך html2canvas) - כך
// שמסמך של 5 עמודים דורש רק 3 צילומים (כותרת, פוטר, תוכן) ולא 5.
// ============================================================
const BSD_BRAND = {
  pageW: 210, pageH: 297, headerH: 30, footerH: 26,
  marginSide: 16, contentTopPad: 10, contentBottomPad: 6,
  navy: '#17365D', navy2: '#1f4577', gold: '#C89B2C',
  cream: '#f3e7c4', bg: '#fbfaf6', text: '#1c2333',
  tagline: 'משביחים עסקים. מחברים הזדמנויות. מובילים עסקאות.',
  footerTagline: 'עסקים טובים יוצרים הזדמנויות. החלטות נכונות הופכות אותן להצלחה.',
};

function bsdEsc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function bsdBuildHeaderEl(dateStr, logoSrc){
  const el = document.createElement('div');
  el.style.cssText = `width:${BSD_BRAND.pageW}mm;height:${BSD_BRAND.headerH}mm;background:linear-gradient(90deg,${BSD_BRAND.navy} 0%,${BSD_BRAND.navy2} 55%,${BSD_BRAND.navy} 100%);display:flex;align-items:center;justify-content:space-between;padding:0 14mm;box-sizing:border-box;border-bottom:2px solid ${BSD_BRAND.gold};font-family:'Heebo','Rubik','Arial Hebrew',sans-serif;direction:rtl;`;
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <img src="${bsdEsc(logoSrc)}" style="height:20mm;width:20mm;object-fit:contain;">
      <div style="line-height:1.2;">
        <div style="font-size:15pt;font-weight:700;letter-spacing:.5px;color:${BSD_BRAND.cream};">BSD BUSINESS BROKERS ISRAEL</div>
        <div style="font-size:8pt;color:#b9c2d6;letter-spacing:1.5px;">רשת התיווך העסקי המקצועית של ישראל</div>
      </div>
    </div>
    <div style="text-align:left;direction:ltr;color:#d9c791;font-size:9.5pt;line-height:1.5;border-inline-start:1px solid rgba(255,255,255,.2);padding-inline-start:14px;">
      <span style="display:block;color:#8993ab;font-size:7.5pt;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">Date</span>${bsdEsc(dateStr)}
    </div>`;
  return el;
}

function bsdBuildFooterEl(tagline){
  const el = document.createElement('div');
  el.style.cssText = `width:${BSD_BRAND.pageW}mm;height:${BSD_BRAND.footerH}mm;background:${BSD_BRAND.navy};color:#e7e2d2;padding:5mm 14mm 4mm 14mm;box-sizing:border-box;border-top:2px solid ${BSD_BRAND.gold};font-family:'Heebo','Rubik','Arial Hebrew',sans-serif;direction:rtl;position:relative;`;
  el.innerHTML = `
    <div style="text-align:center;font-size:10.5pt;color:${BSD_BRAND.cream};font-weight:600;letter-spacing:.3px;margin-bottom:3mm;">${bsdEsc(tagline || BSD_BRAND.footerTagline)}</div>
    <div style="display:flex;justify-content:center;align-items:center;gap:4px;font-size:8.5pt;color:#c7cee2;flex-wrap:wrap;">
      <span dir="ltr">www.bsd-bbi.co.il</span>&nbsp;&nbsp;&nbsp;<span style="width:3px;height:3px;border-radius:50%;background:${BSD_BRAND.gold};display:inline-block;"></span>&nbsp;&nbsp;&nbsp;<span dir="ltr">info@bsd-bbi.co.il</span>&nbsp;&nbsp;&nbsp;<span style="width:3px;height:3px;border-radius:50%;background:${BSD_BRAND.gold};display:inline-block;"></span>&nbsp;&nbsp;&nbsp;<span dir="ltr">054-2424999</span>
    </div>`;
  return el;
}

// captures a small, fixed-size, off-screen element to a canvas (used for header/footer)
async function bsdCaptureElOffscreen(el){
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;';
  holder.appendChild(el);
  document.body.appendChild(holder);
  try {
    await window.__bsdPdfLibsPromise;
    await bsdNextPaint();
    return await window.html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null });
  } finally {
    holder.remove();
  }
}

// עוטף bsdRenderElementToPdf (התוכן בלבד) בתוך תבנית המותג המלאה - כותרת
// עליונה + פוטר על כל עמוד, לוגו, פס זהב, RTL מלא. filename ל-download בלבד.
async function bsdRenderBrandedPdf({ titleText, subtitleText, bodyEl, tagline, dateStr, logoSrc }){
  await window.__bsdPdfLibsPromise;
  logoSrc = logoSrc || 'bsd_logo.png';
  dateStr = dateStr || new Date().toLocaleDateString('he-IL');

  const headerCanvas = await bsdCaptureElOffscreen(bsdBuildHeaderEl(dateStr, logoSrc));
  const footerCanvas = await bsdCaptureElOffscreen(bsdBuildFooterEl(tagline));

  // אזור תוכן: רק הכותרת+גוף המסמך, ברוחב שמתאים בדיוק לשוליים בתבנית המאושרת
  const contentWidthMm = BSD_BRAND.pageW - BSD_BRAND.marginSide * 2;
  const contentWrap = document.createElement('div');
  contentWrap.style.cssText = `width:${contentWidthMm}mm;background:${BSD_BRAND.bg};font-family:'Heebo','Rubik','Arial Hebrew',sans-serif;direction:rtl;text-align:right;color:${BSD_BRAND.text};padding:2mm 0;box-sizing:border-box;`;
  const titleEl = document.createElement('h1');
  titleEl.style.cssText = `font-size:20pt;color:${BSD_BRAND.navy};margin:0 0 4px 0;border-inline-start:5px solid ${BSD_BRAND.gold};padding-inline-start:12px;`;
  titleEl.textContent = titleText || '';
  contentWrap.appendChild(titleEl);
  if (subtitleText){
    const subEl = document.createElement('div');
    subEl.style.cssText = 'font-size:10pt;color:#6c7488;margin:0 0 8mm 15px;padding-inline-start:12px;';
    subEl.textContent = subtitleText;
    contentWrap.appendChild(subEl);
  }
  contentWrap.appendChild(bodyEl);

  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;background:#fff;';
  holder.appendChild(contentWrap);
  document.body.appendChild(holder);
  let contentCanvas;
  try {
    await bsdNextPaint();
    contentCanvas = await window.html2canvas(contentWrap, { scale: 2, useCORS: true, backgroundColor: '#fbfaf6' });
  } finally { holder.remove(); }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const usableContentHeightMm = BSD_BRAND.pageH - BSD_BRAND.headerH - BSD_BRAND.footerH - BSD_BRAND.contentTopPad - BSD_BRAND.contentBottomPad;
  const pxPerMm = contentCanvas.width / contentWidthMm;
  const pageContentHeightPx = Math.max(1, Math.floor(usableContentHeightMm * pxPerMm));
  const totalPages = Math.max(1, Math.ceil(contentCanvas.height / pageContentHeightPx));

  const headerImg = headerCanvas.toDataURL('image/png');
  const footerImg = footerCanvas.toDataURL('image/png');

  for (let i = 0; i < totalPages; i++){
    if (i > 0) pdf.addPage();
    pdf.addImage(headerImg, 'PNG', 0, 0, BSD_BRAND.pageW, BSD_BRAND.headerH);
    pdf.addImage(footerImg, 'PNG', 0, BSD_BRAND.pageH - BSD_BRAND.footerH, BSD_BRAND.pageW, BSD_BRAND.footerH);

    const remaining = contentCanvas.height - i * pageContentHeightPx;
    const sliceHeightPx = Math.min(pageContentHeightPx, remaining);
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = contentCanvas.width;
    sliceCanvas.height = sliceHeightPx;
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = BSD_BRAND.bg; ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(contentCanvas, 0, i * pageContentHeightPx, contentCanvas.width, sliceHeightPx, 0, 0, contentCanvas.width, sliceHeightPx);
    const sliceImg = sliceCanvas.toDataURL('image/png');
    const sliceHeightMm = sliceHeightPx / pxPerMm;
    pdf.addImage(sliceImg, 'PNG', BSD_BRAND.marginSide, BSD_BRAND.headerH + BSD_BRAND.contentTopPad, contentWidthMm, sliceHeightMm);

    // מספר עמוד: ספרות בלבד (אין עברית) - jsPDF יכול לכתוב את זה ישירות
    // בלי בעיית bidi, בפינה השמאלית התחתונה של הפוטר (כמו בתבנית המאושרת).
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(125, 135, 163);
    pdf.text(`${i + 1} / ${totalPages}`, BSD_BRAND.marginSide, BSD_BRAND.pageH - 3, { align: 'left' });
  }

  const blob = pdf.output('blob');
  if (!blob || blob.size < 1000) throw new Error('קובץ PDF פגום/קטן מדי');
  return { blob, pages: totalPages };
}
