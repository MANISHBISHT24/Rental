// index.html aur my.html dono yahi use karte hain
const API = (['localhost', '127.0.0.1'].includes(location.hostname) && location.port !== '8080') ? 'http://localhost:8080' : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const authHdr = () => { const t = localStorage.getItem('hr_token'); return t ? { Authorization: 'Bearer ' + t } : {}; };

function loadRzp() {
  return new Promise((ok, no) => {
    if (window.Razorpay) return ok();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = ok; s.onerror = () => no(new Error('Payment window load nahi hui. Internet check karein.'));
    document.head.appendChild(s);
  });
}

// Advance payment: order banao -> Razorpay window -> server par verify
async function payAdvance(id, ptoken) {
  const r = await fetch(API + '/api/payments/order', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHdr() }, body: JSON.stringify({ id, ptoken }) });
  const o = await r.json();
  if (!r.ok) throw new Error(o.error || 'Payment shuru nahi ho paya');
  await loadRzp();
  return new Promise((resolve, reject) => {
    const rz = new Razorpay({
      key: o.key, amount: o.amount, currency: 'INR', order_id: o.orderId,
      name: 'Himalayan Rides', description: 'Advance for booking #' + id,
      prefill: { name: o.name, email: o.email, contact: o.phone }, theme: { color: '#fbb825' },
      handler: async resp => {
        try {
          const v = await fetch(API + '/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...resp }) });
          const d = await v.json();
          if (!v.ok) throw new Error(d.error || 'Payment verify nahi hui');
          resolve(d);
        } catch (e) { reject(e); }
      },
      modal: { ondismiss: () => reject(new Error('Payment cancel ho gayi.')) }
    });
    rz.on('payment.failed', e => reject(new Error(e.error?.description || 'Payment fail ho gayi.')));
    rz.open();
  });
}
