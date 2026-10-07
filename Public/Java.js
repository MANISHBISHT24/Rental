// Initialize Lenis Smooth Scroll
const lenis = new Lenis({
  duration: 1.2, // Scroll inertia kitni der rahegi
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Smooth curve
  smoothWheel: true,
  touchMultiplier: 2,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);

}

requestAnimationFrame(raf);

let packages = [
  {name:'Om Parvat Expedition', tags:'Spiritual Ride | Breathtaking Views', days:8, km:'5,500', price:28999, img:'Images_2/OM.jpg.jpg', bg:'#456,#9ab'},
  {name:'Adi Kailash Yatra', tags:'Adventure | Spiritual | Offbeat', days:10, km:'6,800', price:34999, img:'Images_2/adikailesh.jpg.jpg', bg:'#345,#b88'},
  {name:'Combo: Om Parvat + Adi Kailash', tags:'Complete Himalayan Experience', days:14, km:'9,500', price:49999, img:'images/g1.jpg.png', bg:'#654,#89a'}
];
let reviews = [
  {n:'Rohit Sharma', c:'Delhi', t:'The entire experience was beyond amazing. The team was professional, the bikes were in top condition, and the views... just surreal!'},
  {n:'Neha Verma', c:'Bangalore', t:'Om Parvat is a place you have to experience at least once in your life. Thanks to the team for making it so smooth and memorable!'},
  {n:'Aman Singh', c:'Lucknow', t:'Best decision ever! From the booking process to the ride, everything was well organized. Highly recommended!'},
  {n:'Priya Nair', c:'Kochi', t:'Felt safe the whole way. The guides knew every turn and the support van was always close by.'},
  {n:'Karan Mehta', c:'Mumbai', t:'Adi Kailash on a Himalayan was a dream. Great itinerary and well-maintained bikes.'}
];
const inr = n => '₹ ' + n.toLocaleString('en-IN');
const $ = s => document.querySelector(s);

// Package cards + filter + details
packages.forEach((p,i)=>p.key=['om','adi','combo'][i]);
const details = {
 om:{hi:['Om Parvat view','Gunji village','Kali river road','Permit help'],days:['Arrive in Haldwani, bike handover','Haldwani → Pithoragarh','Pithoragarh → Dharchula','Dharchula → Gunji','Gunji → Nabhidhang (Om Parvat) and back','Gunji → Dharchula','Dharchula → Pithoragarh','Pithoragarh → Haldwani, trip ends']},
 adi:{hi:['Adi Kailash','Parvati Sarovar','Jolingkong','Offbeat roads'],days:['Arrive in Haldwani, bike handover','Haldwani → Almora','Almora → Pithoragarh','Pithoragarh → Dharchula','Dharchula → Gunji','Gunji → Kuti village','Kuti → Jolingkong (Adi Kailash)','Parvati Sarovar and Gauri Kund','Return to Dharchula','Dharchula → Haldwani, trip ends']},
 combo:{hi:['Om Parvat','Adi Kailash','Parvati Sarovar','Best value'],days:['Arrive in Haldwani, bike handover','Haldwani → Almora','Almora → Pithoragarh','Pithoragarh → Dharchula','Dharchula → Gunji','Rest and acclimatisation day','Gunji → Nabhidhang (Om Parvat)','Nabhidhang → Kuti','Kuti → Jolingkong (Adi Kailash)','Parvati Sarovar and Gauri Kund','Return to Gunji','Gunji → Dharchula','Dharchula → Pithoragarh','Pithoragarh → Haldwani, trip ends']}
};
let curF = 'all';
function renderPkgs(f='all'){ curF = f;
  $('#pkgGrid').innerHTML = packages.filter(p=>f==='all'||p.key===f).map(p=>`
  <article class="card">
    <div class="img" style="background-image:url(${p.img}),linear-gradient(135deg,${p.bg})"></div>
    <div class="card-b">
      <h3>${esc(p.name)}</h3><p class="tags">${esc(p.tags)}</p>
      <div class="meta"><span>📅 ${p.days} Days</span><span>🏍 ${p.km} km</span></div>
      <div class="card-f"><div class="price">${p.price ? `${inr(p.price)} <small>per person</small>` : '<small>Call for price</small>'}</div>
      <div class="card-act"><button class="btn btn-ghost" data-d="${p.key}">Details</button><a href="#book" class="btn btn-yellow" data-pick="${esc(p.name)}">Book Now</a></div></div>
    </div>
  </article>`).join('');
}
renderPkgs();
let CFG = { whatsapp: '919927706844', payEnabled: false, advancePercent: 20 };
fetch(API + '/api/config').then(r => r.json()).then(c => CFG = { ...CFG, ...c }).catch(() => {});
function fillSelect(){ const s = document.querySelector('#bookForm [name=pkg]'); s.innerHTML = packages.map(p => `<option>${esc(p.name)}</option>`).join('') + '<option>Only bike rental</option>'; }
// Packages ab server se aate hain (admin se keemat badal sakte hain). Server band ho to upar wali list chalti rahegi.
fetch(API + '/api/packages').then(r => r.json()).then(list => { if (Array.isArray(list) && list.length) { packages = list; renderPkgs(curF); fillSelect(); } }).catch(() => {});
$('#tabs').onclick = e => { const b = e.target.closest('button'); if(!b) return;
  document.querySelectorAll('#tabs button').forEach(x=>x.classList.toggle('on',x===b)); renderPkgs(b.dataset.f); };
$('#pkgGrid').onclick = e => {
  const pick = e.target.closest('[data-pick]');
  if(pick){ const s = document.querySelector('#bookForm [name=pkg]'); [...s.options].forEach(o=>{ if(o.text===pick.dataset.pick) s.value=o.value; }); return; }
  const d = e.target.closest('[data-d]'); if(!d) return;
  const p = packages.find(x=>x.key===d.dataset.d), x = details[p.key] || {hi:[],days:[]};
  openModal(`<h3>${esc(p.name)}</h3><p class="muted">${p.days} days · ${p.km} km · ${inr(p.price)} per person</p>
   <h4>Highlights</h4><ul>${x.hi.map(h=>`<li>${h}</li>`).join('')}</ul>
   ${x.days.length ? `<h4>Day-wise plan</h4><ol>${x.days.map(t=>`<li>${t}</li>`).join('')}</ol>` : '<p class="muted" style="margin-top:14px">Itinerary jaldi add hogi. Details ke liye WhatsApp karein.</p>'}
   <p style="margin-top:22px"><a href="#book" class="btn btn-yellow" onclick="closeModal()">Book this tour</a></p>`);
  body.className='detail'; body.style.backgroundImage='';
};

// Review slider (3 at a time, 1 on mobile)
let start = 0;
const perView = () => innerWidth <= 900 ? 1 : 3;
function renderReviews(){
  const n = perView(), items = [];
  for(let i = 0; i < n; i++) items.push(reviews[(start + i) % reviews.length]);
  $('#reviewTrack').innerHTML = items.map(r => `
    <div class="rev"><div class="rev-h"><div class="av">${r.n[0]}</div><div><b>${r.n}</b><small>${r.c}</small></div></div>
    <p>${r.t}</p><div class="stars">★★★★★</div></div>`).join('');
}
$('#next').onclick = () => { start = (start + 1) % reviews.length; renderReviews(); };
$('#prev').onclick = () => { start = (start - 1 + reviews.length) % reviews.length; renderReviews(); };
addEventListener('resize', renderReviews);
renderReviews();
fetch(API + '/api/reviews').then(r => r.json()).then(d => { if (Array.isArray(d) && d.length) { reviews = d; start = 0; renderReviews(); } }).catch(() => {});

// Navbar: solid on scroll, mobile menu, active link
const nav = $('#nav'), menu = $('#menu');
addEventListener('scroll', () => nav.classList.toggle('solid', scrollY > 40));
$('#burger').onclick = () => menu.classList.toggle('open');
menu.addEventListener('click', e => { if(e.target.tagName === 'A') menu.classList.remove('open'); });
const links = [...menu.querySelectorAll('a')];
const io = new IntersectionObserver(es => es.forEach(e => {
  if(e.isIntersecting) links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
}), {rootMargin:'-45% 0px -50% 0px'});
['home','packages','about','gallery','reviews'].forEach(id => io.observe(document.getElementById(id)));

// Modal (video + gallery photos)
const modal = $('#modal'), body = $('#modalBody');
const openModal = html => { body.style.backgroundImage = ''; body.innerHTML = html; modal.hidden = false; };
const closeModal = () => { modal.hidden = true; body.innerHTML = ''; body.className=''; };
$('#watchBtn').onclick = () => openModal('<p>Apni video yahan lagayein: &lt;iframe&gt; ya &lt;video&gt; tag</p>');
document.querySelectorAll('.g').forEach(g => g.onclick = () => { openModal(''); body.style.backgroundImage = `url(${g.dataset.img})`; });
$('#closeModal').onclick = closeModal;
modal.onclick = e => { if(e.target === modal) closeModal(); };
addEventListener('keydown', e => { if(e.key === 'Escape') closeModal(); });

// Counters
const cio = new IntersectionObserver(es => es.forEach(e => { if(!e.isIntersecting) return; cio.unobserve(e.target);
  e.target.querySelectorAll('b').forEach(b => { const n = +b.dataset.n, t0 = performance.now();
    const step = t => { const k = Math.min((t-t0)/1200,1); b.textContent = Math.round(n*k).toLocaleString('en-IN') + (k===1 && n>=1000 ? '+' : ''); if(k<1) requestAnimationFrame(step); };
    requestAnimationFrame(step); }); }), {threshold:.5});
cio.observe(document.querySelector('.stats'));

// Booking form -> backend (+ optional online advance payment)
$('#bookForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, btn = form.querySelector('button[type=submit]');
  const f = Object.fromEntries(new FormData(form));
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    const r = await fetch(API + '/api/bookings', { method: 'POST', headers: {'Content-Type': 'application/json', ...authHdr()}, body: JSON.stringify(f) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    form.reset();
    showBooked(d, f);
  } catch (err) { alert(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Send Booking Request'; }
});
function showBooked(d, f) {
  const wa = `https://wa.me/${CFG.whatsapp}?text=` + encodeURIComponent(`Hi, I just sent booking request #${d.id} for ${f.pkg}.`);
  const canPay = d.payEnabled && d.advance > 0;
  openModal(`<h3>Booking request received ✅</h3>
    <p class="muted">Thanks ${esc(f.name)}! Your request ID is <b>#${d.id}</b>. Our team will call you shortly.</p>
    ${canPay ? `<p style="margin-top:16px">Confirm your seat with an advance of <b>${inr(d.advance)}</b> (of ${inr(d.total)}).</p>
      <p style="margin-top:12px"><button class="btn btn-yellow" id="payNow">Pay ${inr(d.advance)} now</button></p>
      <p class="muted" style="margin-top:8px">Prefer later? You can pay anytime from <a href="my.html" class="link">My Bookings</a>.</p>` : ''}
    <p style="margin-top:16px"><a class="btn btn-wa" target="_blank" rel="noopener" href="${wa}">Chat on WhatsApp</a></p>`);
  body.className = 'detail';
  const pb = $('#payNow');
  if (pb) pb.onclick = async () => {
    pb.disabled = true; pb.textContent = 'Opening payment...';
    try {
      await payAdvance(d.id, d.ptoken);
      openModal(`<h3>Payment received ✅</h3><p class="muted">Thank you! Your advance for booking #${d.id} is paid. We will confirm your trip shortly.</p>`);
      body.className = 'detail';
    } catch (err) { alert(err.message); pb.disabled = false; pb.textContent = 'Pay ' + inr(d.advance) + ' now'; }
  };
}

// Back to top
const toTopBtn = $('#totop');
addEventListener('scroll', () => toTopBtn.hidden = scrollY < 600);
toTopBtn.onclick = () => scrollTo({top:0, behavior:'smooth'});

const revealElements = document.querySelectorAll(
  '.reveal, .reveal-left, .reveal-right'
);

const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        observer.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.15
  }
);

revealElements.forEach(element => {
  revealObserver.observe(element);
});