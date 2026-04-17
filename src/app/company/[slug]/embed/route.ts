import { NextResponse } from "next/server";

function escapeJsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, "\\n");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (typeof process.env.VERCEL_URL === "string" ? `https://${process.env.VERCEL_URL}` : "");

  const safeSlug = escapeJsString(slug);
  const safeOrigin = escapeJsString(origin || "");

  const js = `
(function(){
  function esc(t){ return String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
  var slug = '${safeSlug}';
  var origin = '${safeOrigin}';
  var root = document.createElement('div');
  root.setAttribute('data-dajsrce-embed', slug);
  root.style.cssText = 'font-family:system-ui,-apple-system,sans-serif;border:1px solid #e5e7eb;border-radius:12px;padding:16px;max-width:320px;background:#fff;color:#111;line-height:1.4;';
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.style.background = '#111827';
    root.style.color = '#f9fafb';
    root.style.borderColor = '#374151';
  }
  var s = document.currentScript;
  var parent = s && s.parentNode ? s.parentNode : document.body;
  if (s && s.parentNode) {
    parent.insertBefore(root, s.nextSibling);
  } else {
    parent.appendChild(root);
  }
  var base = origin || (typeof location !== 'undefined' ? location.origin : '');
  if (!base) { root.textContent = 'DajSrce'; return; }
  fetch(base + '/api/public/company/' + encodeURIComponent(slug) + '/card')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || d.error) { root.textContent = 'DajSrce'; return; }
      var given = d.metrics && d.metrics.total_given_eur != null
        ? Number(d.metrics.total_given_eur).toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' })
        : '—';
      root.innerHTML =
        '<div style="font-weight:700;font-size:1rem;margin-bottom:8px">' + esc(d.title) + '</div>' +
        (d.tagline ? '<div style="font-size:0.875rem;opacity:0.85;margin-bottom:8px">' + esc(d.tagline) + '</div>' : '') +
        '<div style="font-size:0.8rem;opacity:0.9">Giving: ' + esc(given) + '</div>' +
        '<a href="' + encodeURI(String(d.profile_url || '#')) + '" rel="noopener noreferrer" target="_blank" style="display:inline-block;margin-top:12px;color:#EF4444;font-weight:600;text-decoration:none;font-size:0.875rem">View profile</a>';
    })
    .catch(function(){ root.textContent = 'DajSrce'; });
})();
`.trim();

  return new NextResponse(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=120",
    },
  });
}
