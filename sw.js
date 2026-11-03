// Aevon校园交流网 service worker（bot2 负责）：只缓存同源静态文件，从不缓存 /api、管理后台和上传的图片。
// 页面和程序代码网络优先，断网时使用缓存；图片等资源先用缓存、后台更新。
const V='aevon-static-v12';
const PRE=['/','/index.html','/tasks.html','/leaderboard.html','/task-entry.js','/chat.html','/me.html','/login.html','/recharge.html','/config.js','/session.js','/feedback.js','/orders.js','/ui.css','/pwa.js','/favicon.svg','/icon-192.png','/icon-512.png','/manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(PRE.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const STATIC=/\.(html|js|css|json|png|svg|jpg|webp|ico)$/;
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);if(u.origin!==location.origin)return;
  const p=u.pathname;
  if(p==='/api'||p.startsWith('/api/')||p==='/sw.js'||p.startsWith('/admin')||p.startsWith('/data/')||p.startsWith('/uploads'))return;
  const page=r.mode==='navigate'||p==='/'||p.endsWith('.html');
  const code=/\.(js|css)$/.test(p);
  if(!page&&!STATIC.test(p))return;
  const save=res=>{if(res.ok&&res.type==='basic'){const c=res.clone();e.waitUntil(caches.open(V).then(x=>x.put(r,c)).catch(()=>{}))}return res};
  if(page){e.respondWith(fetch(r).then(save).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('/index.html'))));return}
  if(code){e.respondWith(fetch(r).then(save).catch(()=>caches.match(r)));return}
  e.respondWith(caches.match(r).then(m=>{const net=fetch(r).then(save).catch(()=>m);return m||net}));
});
