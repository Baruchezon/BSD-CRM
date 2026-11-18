/* BSD public website posters. An approved human selection is required.
   Images generated here are never published or saved automatically. */
(function () {
  'use strict';
  const jobs = new Map();
  const N = 1280, H = 720, PHOTO_W = 780;
  const gold = '#e0bc68', navy = '#071831';

  function status(message, failure) {
    const el = document.getElementById('bsdPosterGenerationStatus');
    if (el) {
      el.style.color = failure ? '#b13222' : '#235743';
      el.textContent = message;
    }
  }
  function getBiz(id) {
    if (typeof bsdFindCachedBiz === 'function') return bsdFindCachedBiz(id);
    return null;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('לא ניתן לטעון תמונה או את הלוגו הרשמי'));
      el.src = src;
    });
  }
  function contain(ctx, image, x, y, w, h) {
    const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
    const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function cover(ctx, image, x, y, w, h) {
    const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
    const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
    ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function fitLines(ctx, text, maxWidth, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const limited = lines.slice(0, maxLines);
      let last = limited[maxLines - 1];
      while (last.length && ctx.measureText(last + '…').width > maxWidth) {
        last = last.slice(0, -1);
      }
      limited[maxLines - 1] = last.trim() + '…';
      return limited;
    }
    return lines;
  }
  function safeClaim(line, biz) {
    const text = String(line || '').replace(/^[•*\s]+/, '').replace(/^\w{1,18}:/, '').trim();
    if (text.length < 9 || text.length > 74) return '';
    if (/https?:|www\.|@|0\d{1,2}[- ]?\d{7}|(?:רווח|רווחים|רווחיות)/i.test(text)) return '';
    const privateFields = [
      biz?.internal_name, biz?.legal_name, biz?.owner_name, biz?.owner_phone,
      biz?.owner_email, biz?.address, biz?.website
    ].filter(v => typeof v === 'string' && v.trim().length >= 4);
    return privateFields.some(v => text.toLowerCase().includes(v.trim().toLowerCase())) ? '' : text;
  }
  function claims(biz) {
    const summary = String(biz?.anon_summary || '');
    const bullets = summary.split(/\n/).filter(s => /^\s*[•*]/.test(s))
      .map(s => safeClaim(s, biz)).filter(Boolean);
    const years = Number(biz?.years_active);
    if (Number.isFinite(years) && years > 0 && years <= 150 && !bullets.some(s => /שנ(?:ים|ות)/.test(s))) {
      bullets.unshift(years + ' שנות פעילות');
    }
    const unique = [...new Set(bullets)];
    return unique.slice(0, 3);
  }
  function drawText(ctx, text, x, y, maxWidth, maxLines, font, color, spacing) {
    ctx.fillStyle = color;
    ctx.font = font;
    const lines = fitLines(ctx, text, maxWidth, maxLines);
    lines.forEach((line, i) => ctx.fillText(line, x, y + i * spacing));
    return y + lines.length * spacing;
  }
  async function compose(generated, biz, variant) {
    const logoUrl = new URL('bsd_logo.png', document.baseURI).href;
    const [photo, logo] = await Promise.all([
      loadImage('data:image/jpeg;base64,' + generated.image_base64),
      loadImage(logoUrl)
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = N;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('הדפדפן אינו תומך ביצירת פוסטר');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = '#d6dde7';
    ctx.fillRect(0, 0, PHOTO_W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PHOTO_W, H);
    ctx.clip();
    // Blurred backdrop is decorative. The foreground photo below is 100% visible.
    ctx.filter = 'blur(24px) brightness(.7)';
    cover(ctx, photo, -24, -24, PHOTO_W + 48, H + 48);
    ctx.filter = 'none';
    contain(ctx, photo, 0, 0, PHOTO_W, H);
    ctx.restore();

    const gradient = ctx.createLinearGradient(PHOTO_W, 0, N, H);
    gradient.addColorStop(0, '#06142e');
    gradient.addColorStop(1, '#102b58');
    ctx.fillStyle = gradient;
    ctx.fillRect(PHOTO_W, 0, N - PHOTO_W, H);
    ctx.fillStyle = gold;
    ctx.fillRect(PHOTO_W, 0, 5, H);

    const mid = PHOTO_W + (N - PHOTO_W) / 2;
    ctx.drawImage(logo, mid - 55, 22, 110, 110);
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#f2e4c6';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.fillText('משביחים עסקים.', mid, 158);
    ctx.fillText('מחברים הזדמנויות.', mid, 183);
    ctx.fillText('מובילים עסקאות.', mid, 208);

    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    const right = N - 32, maxW = N - PHOTO_W - 64;
    ctx.fillStyle = gold;
    ctx.font = 'bold 61px Arial, sans-serif';
    ctx.fillText('למכירה', right, 289);
    const type = String(biz?.anon_display_name || biz?.field || biz?.category || 'עסק')
      .replace(/\s+/g, ' ').trim().slice(0, 90);
    let y = drawText(ctx, type, right, 343, maxW, 2,
      'bold 38px Arial, sans-serif', '#ffffff', 43);
    y = Math.max(y + 12, 439);

    const items = claims(biz);
    for (const item of items) {
      if (y >= 572) break;
      ctx.font = 'bold 23px Arial, sans-serif';
      const line = fitLines(ctx, item, maxW - 25, 1)[0];
      if (!line) continue;
      ctx.fillStyle = gold;
      ctx.fillText('•', right, y);
      ctx.fillStyle = '#f5f6fa';
      ctx.fillText(line, right - 22, y);
      y += 42;
    }

    ctx.fillStyle = gold;
    ctx.fillRect(PHOTO_W + 28, 601, N - PHOTO_W - 56, 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8f8f9';
    ctx.font = 'bold 24px Arial, sans-serif';
    ctx.fillText('לפרטים נוספים', mid, 632);
    ctx.font = 'bold 20px Arial, sans-serif';
    ctx.direction = 'ltr';
    ctx.fillText('077-4446707  |  054-2424999', mid, 661);
    ctx.fillStyle = gold;
    ctx.font = 'bold 23px Arial, sans-serif';
    ctx.fillText('bsd-bbi.co.il', mid, 695);
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (!blob) reject(new Error('לא ניתן לשמור את הפוסטר'));
      else resolve(blob);
    }, 'image/webp', 0.92));
  }
  function clear(id) {
    const old = jobs.get(id);
    if (old?.items) old.items.forEach(it => URL.revokeObjectURL(it.url));
    jobs.set(id, { running: false, items: [] });
    const gallery = document.getElementById('bsdPosterGallery');
    if (gallery) gallery.replaceChildren();
  }
  async function generate(id, count) {
    if (count !== 1 && count !== 4) return;
    const biz = getBiz(id);
    if (!biz) { status('לא ניתן לאתר את כרטיס העסק. יש לפתוח את הכרטיס מחדש.', true); return; }
    const running = jobs.get(id);
    if (running?.running) return;
    const panel = document.getElementById('bsdSitePublisher');
    if (!panel) return;
    // A deliberate click is required for each paid image generation batch.
    clear(id);
    const job = jobs.get(id);
    job.running = true;
    const buttons = [...panel.querySelectorAll('[data-bsd-image-create]')];
    buttons.forEach(btn => { btn.disabled = true; });
    try {
      for (let i = 0; i < count; i++) {
        status('מייצר תמונה ' + (i + 1) + ' מתוך ' + count + ' באמצעות OpenAI...');
        const { data, error } = await bsdInvokeAiFn('generate-site-listing-image', {
          body: { business_id: id, variant_index: i }
        });
        if (error || !data?.ok || !data.image_base64) {
          let details = null;
          try { details = await error?.context?.json?.(); } catch (_) {}
          throw new Error(details?.error || data?.error || error?.message || 'שירות התמונות לא החזיר תמונה');
        }
        const blob = await compose(data, biz, i);
        if (blob.size > 10 * 1024 * 1024) throw new Error('התמונה גדולה מדי לשמירה');
        const url = URL.createObjectURL(blob);
        job.items.push({ blob, url });
        showGallery(id, job.items);
      }
      status('התמונות מוכנות. בחר את התמונה המתאימה, בדוק את הפרטים ואשר לפני פרסום.');
    } catch (err) {
      status('הפקת התמונות הופסקה: ' + (err?.message || String(err)), true);
    } finally {
      job.running = false;
      buttons.forEach(btn => { btn.disabled = false; });
    }
  }
  function showGallery(id, items) {
    const gallery = document.getElementById('bsdPosterGallery');
    if (!gallery) return;
    gallery.replaceChildren();
    const title = document.createElement('div');
    title.textContent = 'תצוגה מקדימה: יש לבחור תמונה לאישור';
    title.style.cssText = 'width:100%;font-weight:700;margin:8px 0';
    gallery.appendChild(title);
    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid #ddd;border-radius:10px;padding:8px;background:#fff;';
      const photo = document.createElement('img');
      photo.src = item.url;
      photo.alt = 'תמונת פרסום מוצעת ' + (index + 1);
      photo.style.cssText = 'width:100%;height:165px;object-fit:contain;background:#e9eef4;border-radius:6px;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.style.cssText = 'display:block;width:100%;margin-top:7px;';
      btn.textContent = 'בחר תמונה ' + (index + 1);
      btn.addEventListener('click', () => select(id, index));
      card.append(photo, btn);
      gallery.appendChild(card);
    });
  }
  async function select(id, index) {
    const job = jobs.get(id);
    const selected = job?.items?.[index];
    if (!selected) { status('התמונה לא זמינה. יש ליצור אותה מחדש.', true); return; }
    if (!document.getElementById('bsdPublicPhotoApproved')?.checked) {
      status('יש לסמן תחילה שאישרת את התמונה לפרסום אנונימי.', true);
      return;
    }
    const fakeFile = new File([selected.blob], 'bsd-advert-' + (index + 1) + '.webp', {type:'image/webp'});
    const fakeInput = { files:[fakeFile], value:'', disabled:false };
    await bsdUploadPublicSiteImage(id, fakeInput);
    const photoStatus = document.getElementById('bsdPublicPhotoStatus')?.textContent || '';
    if (photoStatus.includes('טיוטה')) status('התמונה נבחרה ונשמרה כטיוטה בלבד. לפרסום באתר יש ללחוץ על ״הפץ לאתר״.');
  }
  window.BSDSitePoster = { generate, select, clear };
})();
