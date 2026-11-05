// Optional browser tests: supply PLAYWRIGHT_MODULE if Playwright is installed outside this project.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture,password,sleep,seed}=require('./helpers.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined),headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{})})});
after(async()=>{if(browser)await browser.close()});
async function setPermissions(call,name,permissions){const d=(await call('/api/admin/roles','AevonEcho')).data,u=d.users.find(x=>x.username===name);const r=await call(`/api/admin/users/${name}/permissions`,'AevonEcho',{permissions,userId:u.userId,version:u.permissionsVersion});assert.equal(r.status,200)}

test('service worker uses current code online and cached code offline',async t=>{
 const http=require('node:http'),fs=require('node:fs');let code='version one';const sw=fs.readFileSync(require('node:path').join(__dirname,'../sw.js'));
 const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url==='/sw.js'){res.setHeader('Content-Type','application/javascript');return res.end(sw)}if(req.url==='/orders.js'){res.setHeader('Content-Type','application/javascript');return res.end(code)}res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>test</title>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const context=await browser.newContext();t.after(async()=>{await context.close();await new Promise(r=>server.close(r))});const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}))});
 code='version two';assert.equal(await page.evaluate(()=>fetch('/orders.js').then(r=>r.text())),'version two');await page.waitForFunction(async()=>{for(const name of await caches.keys()){if(!name.startsWith('aevon-static-'))continue;const c=await caches.open(name),r=await c.match('/orders.js');if(r&&await r.text()==='version two')return true}return false});await context.setOffline(true);assert.equal(await page.evaluate(()=>fetch('/orders.js').then(r=>r.text())),'version two');
});

test('recharge explains manual review and uncertain submissions',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'Bob');await page.goto(base+'/recharge.html');await page.locator('#ra').waitFor();await page.locator('.pay.ali').click();await page.getByText('参考比例：1 元 = 1 积分，按金额向下取整；具体积分以管理员审核为准。不足 1 元请联系管理员处理。',{exact:false}).waitFor();await page.locator('#qc').click();await page.locator('#ra').fill('0.50');await page.getByText('不足 1 元，请联系管理员处理',{exact:true}).waitFor();await page.locator('#ra').fill('2');await page.getByText('预计 2 积分，具体以审核为准',{exact:true}).waitFor();page.on('dialog',d=>d.accept());await page.route('**/api/recharge',route=>route.abort());await page.locator('#rb').click();await page.locator('#msg').getByText('提交结果暂未确认，请先刷新并查看下方充值记录，确认没有该笔记录后再提交。').waitFor();
}));

test('site pages fit narrow mobile and order controls have separate space',t=>fixture(async({base,call})=>{
 await call('/api/announcements','AevonEcho',{title:'重要通知',text:'请留意公告'});const page=await pageFor(t,base,'AevonEcho',[],{viewport:{width:320,height:720},hasTouch:true});
 for(const width of [320,375,390])for(const path of ['/index.html','/login.html','/chat.html','/tasks.html','/me.html','/recharge.html','/admin.html']){await page.setViewportSize({width,height:844});await page.goto(base+path);await page.waitForLoadState('load');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path+' overflows at '+width+'px');if(width===390&&path==='/chat.html'){await page.locator('#ordersOpen').waitFor();await page.locator('#officialHint:not([hidden])').waitFor();const pos=await page.evaluate(()=>{const title=document.querySelector('#title').getBoundingClientRect(),actions=document.querySelector('.topR').getBoundingClientRect(),hint=document.querySelector('#officialHint'),taskHall=document.querySelector('#openTaskHall').getBoundingClientRect(),range=document.createRange();range.selectNodeContents(hint);return {titleBottom:title.bottom,actionsTop:actions.top,textRects:Array.from(range.getClientRects()).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),taskHall}});assert.ok(pos.actionsTop>=pos.titleBottom,'order controls should occupy a separate row');assert.ok(!pos.textRects.some(r=>r.left<pos.taskHall.right&&r.right>pos.taskHall.left&&r.top<pos.taskHall.bottom&&r.bottom>pos.taskHall.top),'chat help text must not be covered by the floating task hall action');await page.screenshot({path:'.review/ui-chat-mobile.png'})}if(width===390&&path==='/index.html'){await page.locator('#annList li').filter({hasText:'重要通知'}).waitFor();const entries=await page.evaluate(()=>['#openTaskHall','#fbBtn','#supportBtn'].map(sel=>{const e=document.querySelector(sel);return {sel,insideHero:!!e?.closest('.hero-tools'),position:e&&getComputedStyle(e).position}}));assert.ok(entries.every(x=>x.insideHero&&x.position==='static'),'homepage quick actions must stay in the hero flow');const overlaps=await page.evaluate(()=>{const d=document.querySelector('#annList .del')?.getBoundingClientRect(),buttons=['#openTaskHall','#fbBtn','#supportBtn'].map(s=>document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);return !!d&&buttons.some(b=>d.left<b.right&&d.right>b.left&&d.top<b.bottom&&d.bottom>b.top)});assert.equal(overlaps,false,'homepage quick actions must not cover announcement controls');await page.screenshot({path:'.review/ui-home-mobile.png',fullPage:true})}if(width===390&&path==='/admin.html'){await page.locator('.tabs').waitFor();await page.screenshot({path:'.review/ui-admin-mobile.png'})}}
 await page.setViewportSize({width:1280,height:900});await page.goto(base+'/chat.html');await page.locator('#ordersOpen').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.review/ui-chat-desktop.png'});
}));

test('chat task hall entry stays in the toolbar flow on mobile',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'Alice',[],{viewport:{width:390,height:844},hasTouch:true});await page.locator('#quickActions #openTaskHall').waitFor();
 const layout=await page.evaluate(()=>{const row=document.querySelector('#quickActions'),link=document.querySelector('#openTaskHall'),messages=document.querySelector('#msgs');return {inside:link?.parentElement===row,position:link&&getComputedStyle(link).position,rowBottom:row.getBoundingClientRect().bottom,messagesTop:messages.getBoundingClientRect().top}});
 assert.equal(layout.inside,true,'chat page should place the order hall link in its own row');assert.equal(layout.position,'static','chat order hall link must not float over the message list or composer');assert.ok(layout.rowBottom<=layout.messagesTop,'chat order entry should come before message results');await page.screenshot({path:'.review/ui-chat-mobile.png'});
}));

test('mobile utility controls stay above the interactive content on recharge and personal center',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'Alice',[],{viewport:{width:390,height:844},hasTouch:true});
 for(const path of ['/recharge.html','/me.html']){
  await page.goto(base+path);await page.locator('#quickActions #openTaskHall').waitFor();await page.locator('#quickActions #supportBtn').waitFor();await page.locator('#quickActions #fbBtn').waitFor();
  await page.locator(path==='/recharge.html'?'#main .card:first-child':'#main .hi').waitFor();
  const layout=await page.evaluate(()=>{const actions=document.querySelector('#quickActions'),content=document.querySelector('#main .hi')||document.querySelector('#main .card'),a=actions.getBoundingClientRect(),c=content.getBoundingClientRect();return {inside:!!actions&&['openTaskHall','supportBtn','fbBtn'].every(id=>document.getElementById(id)?.parentElement===actions),positions:['openTaskHall','supportBtn','fbBtn'].map(id=>getComputedStyle(document.getElementById(id)).position),actionsBottom:a.bottom,contentTop:c.top}});
  assert.equal(layout.inside,true,path+' should keep utility controls in the shared action row');assert.ok(layout.positions.every(x=>x==='static'),path+' utility actions must not float over content');assert.ok(layout.actionsBottom<=layout.contentTop,path+' action row should precede the main form/cards');
  await page.screenshot({path:'.review/ui-'+(path==='/recharge.html'?'recharge':'me')+'-mobile.png',fullPage:true});
 }
}));

test('login utility controls remain below the form on a short mobile screen',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'Alice',[],{viewport:{width:390,height:600},hasTouch:true});await page.goto(base+'/login.html');await page.locator('#quickActions #openTaskHall').waitFor();await page.locator('#quickActions #supportBtn').waitFor();await page.locator('#quickActions #fbBtn').waitFor();
 const layout=await page.evaluate(()=>{const box=document.querySelector('.box'),actions=document.querySelector('#quickActions'),a=actions.getBoundingClientRect(),b=box.getBoundingClientRect();return {positions:['openTaskHall','supportBtn','fbBtn'].map(id=>getComputedStyle(document.getElementById(id)).position),inside:['openTaskHall','supportBtn','fbBtn'].every(id=>document.getElementById(id).parentElement===actions),boxBottom:b.bottom,actionsTop:a.top,actionsBottom:a.bottom,scrollWidth:document.documentElement.scrollWidth}});
 assert.equal(layout.inside,true);assert.ok(layout.positions.every(x=>x==='static'),'login utility controls should stay in normal flow');assert.ok(layout.actionsTop>=layout.boxBottom,'utility controls must not cover the login form');assert.ok(layout.actionsBottom<=600,'utility controls should remain visible on the tested short viewport');assert.ok(layout.scrollWidth<=390,'login page should fit narrow mobile width');await page.screenshot({path:'.review/ui-login-short-mobile.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.review/ui-login-mobile.png'});
}));

test('leaderboard has a visible home exit and fits the narrow mobile viewport',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'Alice',[],{viewport:{width:320,height:720},hasTouch:true});await page.goto(base+'/leaderboard.html');await page.getByRole('heading',{name:/接单排行榜/}).waitFor();
 await page.getByRole('link',{name:'返回首页',exact:true}).waitFor();await page.getByRole('link',{name:'可接任务',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'leaderboard navigation must not overflow a 320px viewport');await page.screenshot({path:'.review/ui-leaderboard-mobile.png',fullPage:true});
}));

test('task cards separate withdrawal from recoverable hiding and admins can pin public tasks and chat',t=>fixture(async({base,task,call})=>{
 const m=await task('Alice',{text:'Recoverable task action'}),cardPath='/api/channels/'+encodeURIComponent(m.channel||'任务大厅')+'/messages/'+m.id;
 const owner=await pageFor(t,base,'Alice');const taskCard=owner.locator('.m').filter({hasText:'Recoverable task action'});await taskCard.waitFor();await taskCard.locator('[data-act="cancel"]').waitFor();assert.equal(await taskCard.locator('[data-act="delete"]').count(),0,'public card should show withdrawal only for its owner');
 owner.on('dialog',d=>d.accept());await owner.goto(base+'/me.html');await owner.locator('#ordersOpen').click();let order=owner.locator('#orderRows .order-card').filter({hasText:'Recoverable task action'});await order.locator('[data-hide]').waitFor();await order.locator('[data-hide]').click();await owner.locator('#orderRows [data-restore]').waitFor();assert.equal((await call('/api/my/points','Alice')).data.points,100,'hide refunds the posting fee');await owner.locator('#orderRows [data-restore]').click();await owner.locator('[data-view="active"]').click();await order.locator('[data-hide]').waitFor();assert.equal((await call('/api/my/points','Alice')).data.points,99,'restore charges the posting fee again');
 await setPermissions(call,'Bob',['pinMessages']);const moderator=await pageFor(t,base,'Bob');await moderator.waitForFunction(()=>can('pinMessages'));const target=moderator.locator('.m').filter({hasText:'Recoverable task action'});await target.locator('[data-pin-action="pin"]').click();await moderator.locator('.pin-board').filter({hasText:'Recoverable task action'}).waitFor();await moderator.goto(base+'/tasks.html');await moderator.locator('#pinnedTasks').getByText('Recoverable task action',{exact:true}).waitFor();
 const publicChat=await call('/api/channels/'+encodeURIComponent('校园聊天')+'/messages','Alice',{text:'Pinned public chat message'});assert.equal(publicChat.status,200);await moderator.goto(base+'/chat.html#'+encodeURIComponent('校园聊天'));await moderator.waitForFunction(()=>can('pinMessages'));const chatCard=moderator.locator('.m').filter({hasText:'Pinned public chat message'});await chatCard.locator('[data-pin-action="pin"]').click();await moderator.locator('.pin-board').filter({hasText:'Pinned public chat message'}).waitFor();
}));

test('payment status is presented as the publisher claim, not verified receipt',t=>fixture(async({base,task,act})=>{
 const m=await task('Alice',{text:'Payment label test'});await act(m,'Bob','claim');await act(m,'Bob','finish');await act(m,'Alice','paid');const page=await pageFor(t,base,'Bob');await page.locator('.m').filter({hasText:'Payment label test'}).getByText('待接单人核实到账',{exact:false}).waitFor();await page.goto(base+'/me.html');await page.getByText('发布人已标记付款，请核实实际到账后确认收款',{exact:false}).first().waitFor();await page.locator('#ordersOpen').click();await page.locator('#orderRows').getByText('待接单人核实到账',{exact:true}).first().waitFor();
}));

test('free completion request is clearly presented to the claimer',t=>fixture(async({base,task,act})=>{
 const m=await task('Alice',{text:'Consent workflow'});await act(m,'Bob','claim');await act(m,'Alice','complete');const page=await pageFor(t,base,'Bob');await page.locator('.m').filter({hasText:'Consent workflow'}).getByText('免付款申请待接单人确认',{exact:false}).waitFor();await page.locator('.m').filter({hasText:'Consent workflow'}).locator('[data-chat]').click();await page.locator('#tcP').getByRole('button',{name:'不同意'}).waitFor();page.on('dialog',d=>d.accept());await page.locator('#tcP').getByRole('button',{name:'不同意'}).click();await page.locator('#tcP').getByRole('button',{name:'我已完成任务'}).waitFor();
}));

test('slow admin chat polling remains single-flight and eventually shows replies',t=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Bob','claim');const page=await pageFor(t,base,'AevonEcho');await page.goto(base+'/admin.html');await page.locator('[data-t=chats]').click();await page.locator('#cb [data-chat]').click();await page.locator('.admin-chat-form').waitFor({state:'visible'});
 let arrivals=0,arrived,release;const waiting=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);await page.route('**/api/tasks/'+m.id+'/chat?after=*',async route=>{arrivals++;arrived();await gate;await route.continue()});await call('/api/tasks/'+m.id+'/chat','Bob',{text:'slow network reply'});try{await waiting;await page.waitForTimeout(4300);assert.equal(arrivals,1)}finally{release()}await page.locator('.cm .ci').filter({hasText:'slow network reply'}).waitFor({timeout:8000});
}));

test('order window separates active and history, filters roles and fits mobile',t=>fixture(async({base,call,task,act})=>{
 const work=await task('Alice',{text:'Parcel pickup at north gate'});await act(work,'Bob','claim');await task('Bob',{text:'Lunch delivery'});const old=await task('Bob',{text:'Cancelled history'});await act(old,'Bob','cancel');const gone=await task('Bob',{text:'Deleted history'});await act(gone,'Bob','delete');
 const page=await pageFor(t,base,'Bob');await page.locator('#ordersOpen').click();await page.locator('#orderRows .order-card').first().waitFor();assert.equal(await page.locator('#orderRows .order-card').count(),2);assert.equal(await page.locator('.orders-summary .needs-action b').textContent(),'1');await page.locator('#orderRole').selectOption('posted');assert.equal(await page.locator('#orderRows .order-card').count(),1);await page.getByRole('tab',{name:'历史订单 · 2',exact:true}).click();assert.equal(await page.locator('#orderRows .order-card').count(),2);await page.locator('#orderQuery').fill('Cancelled');assert.equal(await page.locator('#orderRows .order-card').count(),1);
 await page.locator('#orderRows summary').click();await Promise.all([page.waitForResponse(r=>r.url().includes('/api/my/tasks?includeHistory=1')),page.locator('#ordersRefresh').click()]);await page.waitForTimeout(50);assert.equal(await page.locator('#orderRows details').evaluate(e=>e.open),true);
 for(const width of [320,375,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'order window overflows at '+width+'px');const box=await page.locator('.orders-window').evaluate(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scroll:e.scrollWidth,client:e.clientWidth}));assert.ok(box.left>=0&&box.right<=width,'order window escapes viewport at '+width+'px');assert.ok(box.scroll<=box.client+1,'order content overflows at '+width+'px');if(width===320)await page.screenshot({path:'.review/orders-mobile-320.jpg'})}await page.screenshot({path:'.review/orders-mobile.jpg'});await page.locator('#orderQuery').fill('');await page.locator('#orderRole').selectOption('all');await page.getByRole('tab',{name:'进行中 · 2',exact:true}).click();await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.review/orders-desktop.jpg'});
 await page.getByRole('button',{name:'关闭订单窗口'}).click();await page.goto(base+'/me.html');await page.getByText('订单进度与历史').waitFor();await page.screenshot({path:'.review/order-workspace-desktop.jpg'});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.review/order-workspace-mobile.jpg',fullPage:true});await page.locator('.order-intro button').click();await page.locator('#orderRows').waitFor();
}));

test('repeated refreshes share an in-flight order request and display its result',t=>fixture(async({base,task})=>{
 await task('Bob',{text:'First order'});const page=await pageFor(t,base,'Bob');await page.locator('#ordersOpen').click();await page.locator('#orderRows .order-card').waitFor();await task('Bob',{text:'New order after refresh'});
 let arrivals=0,arrived,release;const waiting=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);await page.route('**/api/my/tasks?includeHistory=1',async route=>{arrivals++;arrived();await gate;await route.continue()});
 try{await page.locator('#ordersRefresh').click();await waiting;await page.locator('#ordersRefresh').click();await page.locator('#ordersRefresh').click();await page.waitForTimeout(200);assert.equal(arrivals,1)}finally{release()}await page.locator('#orderRows').getByText('New order after refresh',{exact:true}).waitFor();
}));

test('former claims appear in history without linking to a later private conversation',t=>fixture(async({base,task,act})=>{
 const m=await task('Alice',{text:'Previously accepted'});await act(m,'Bob','claim');await act(m,'Bob','unclaim');await act(m,'Carol','claim');const page=await pageFor(t,base,'Bob');await page.locator('#ordersOpen').click();await page.getByRole('tab',{name:'历史订单 · 1',exact:true}).click();const card=page.locator('.order-card').filter({hasText:'Previously accepted'});await card.getByText('已放弃接单').waitFor();assert.equal(await card.locator('a').count(),0);
}));

test('a late order response cannot display the previous account after the token changes',t=>fixture(async({base,task})=>{
 await task('Bob',{text:'Bob private order'});const page=await pageFor(t,base,'Bob');let arrived,release;const waiting=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);await page.route('**/api/my/tasks?includeHistory=1',async route=>{arrived();await gate;await route.continue()});await page.locator('#ordersOpen').click();await waiting;await page.evaluate(()=>{localStorage.setItem('token','Carol');localStorage.setItem('username','Carol')});release();await page.waitForFunction(()=>!document.querySelector('.orders-mask'));assert.equal(await page.getByText('Bob private order',{exact:true}).count(),0);
}));

test('administrator participates through the backend chat with a visible identity and receives new replies',t=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Bob','claim');await call('/api/tasks/'+m.id+'/chat','Alice',{text:'Original trade chat'});const page=await pageFor(t,base,'AevonEcho');await page.goto(base+'/admin.html');await page.locator('[data-t=chats]').click();await page.locator('#cb [data-chat]').click();await page.locator('.admin-chat-form').waitFor({state:'visible'});await page.locator('.admin-chat-form input[name=message]').fill('Administrator helping here');await page.locator('.admin-chat-form button[type=submit]').click();await page.locator('.cm .ci').filter({hasText:'Administrator helping here'}).waitFor();assert.ok((await page.locator('.cm .cl').textContent()).includes('管理员'));
 assert.ok((await call('/api/tasks/'+m.id+'/chat','Bob')).data.messages.some(x=>x.text==='Administrator helping here'&&x.moderator));await call('/api/tasks/'+m.id+'/chat','Bob',{text:'Participant reply'});await page.locator('.cm .ci').filter({hasText:'Participant reply'}).waitFor();await page.screenshot({path:'.review/admin-trade-chat.jpg'});
}));

test('read-only chat permission has no composer until explicit participation permission is granted',t=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Carol','claim');await setPermissions(call,'Bob',['viewChats']);const page=await pageFor(t,base,'Bob');await page.goto(base+'/admin.html');await page.locator('#cb [data-chat]').click();await page.locator('.cm .ro').filter({hasText:'只读'}).waitFor();assert.equal(await page.locator('.admin-chat-form').isVisible(),false);await page.locator('.cw h3 button').click();await setPermissions(call,'Bob',['joinChats']);await page.reload();await page.locator('#cb [data-chat]').click();await page.locator('.admin-chat-form').waitFor({state:'visible'});assert.equal(await page.locator('.tabs button').count(),1);
}));

test('deep-linked order opens its conversation even outside the channel cache',t=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Bob','claim');await call('/api/tasks/'+m.id+'/chat','Alice',{text:'Deep linked order message'});const page=await pageFor(t,base,'Bob');await page.route('**/messages?rev=*',r=>r.fulfill({status:200,headers:{'X-Rev':'10'},json:[]}));await page.goto(base+'/chat.html?task='+m.id+'#'+encodeURIComponent('校园跑'));await page.locator('#tcList').getByText('Deep linked order message',{exact:true}).waitFor();assert.equal(await page.locator('#tc').evaluate(e=>e.classList.contains('show')),true);
}));
async function pageFor(t,base,user='Bob',extraStorage=[],options={}){
 const context=await browser.newContext({...options,storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'token',value:user},{name:'username',value:user},{name:'admin',value:user==='AevonEcho'?'1':'0'},...extraStorage]}]}}),page=await context.newPage(),errors=[];
 t.after(async()=>{await context.close();assert.deepEqual(errors,[],'uncaught browser errors')});
 page.on('pageerror',e=>errors.push(e.message));
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await page.goto(base+'/chat.html#'+encodeURIComponent('任务大厅'));await page.waitForFunction(()=>online===true&&points!==null);
 return page;
}

test('task takers can privately consult the publisher before claiming, and the winning inquiry joins order chat',t=>fixture(async({base,call,task,act})=>{
 const m=await task('Alice',{text:'Private seller inquiry flow'}),before=(await call('/api/my/points','Bob')).data.points;
 const buyer=await pageFor(t,base,'Bob');await buyer.goto(base+'/tasks.html');const card=buyer.locator('.card').filter({hasText:m.text});await card.getByRole('link',{name:'💬 咨询发布者'}).click();
 await buyer.locator('#tcTitle').getByText('任务咨询').waitFor();await buyer.locator('#tcT').fill('Can you meet at the library?');await buyer.locator('#tcS').click();await buyer.locator('#tcList').getByText('Can you meet at the library?',{exact:true}).waitFor();
 assert.equal((await call('/api/my/points','Bob')).data.points,before);assert.ok((await call('/api/tasks?status=open','')).data.some(x=>x.id===m.id));
 const seller=await pageFor(t,base,'Alice');await seller.goto(base+'/chat.html#'+encodeURIComponent('任务大厅'));const taskCard=seller.locator('.m').filter({hasText:m.text});await taskCard.locator('.inquiryB').waitFor();await taskCard.locator('.inquiryB').click();
 const thread=seller.locator('.inquiry-thread');await thread.getByText('Bob',{exact:false}).waitFor();await thread.click();await seller.locator('#tcList').getByText('Can you meet at the library?',{exact:true}).waitFor();
 await seller.locator('#tcT').fill('Yes, meet at the north entrance.');await seller.locator('#tcS').click();await seller.locator('#tcList').getByText('Yes, meet at the north entrance.',{exact:true}).waitFor();await buyer.locator('#tcList').getByText('Yes, meet at the north entrance.',{exact:true}).waitFor({timeout:8000});
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII=';await call('/api/tasks/'+m.id+'/chat/image?inquiry=1','Bob',{data:png});await buyer.locator('#tcList img.img').waitFor();await buyer.waitForFunction(()=>[...document.querySelectorAll('#tcList img.img')].some(x=>x.complete&&x.naturalWidth>0));
 await seller.goto(base+'/me.html');await seller.locator('#ordersOpen').click();const order=seller.locator('#orderRows .order-card').filter({hasText:m.text});await order.getByRole('link',{name:/查看咨询/}).waitFor();await order.getByRole('link',{name:/查看咨询/}).click();await seller.locator('.inquiry-thread').getByText('Bob',{exact:false}).waitFor();
 await act(m,'Bob','claim');await buyer.goto(base+'/chat.html?task='+m.id+'#'+encodeURIComponent('任务大厅'));await buyer.locator('#tcTitle').getByText('任务私聊').waitFor();await buyer.locator('#tcList').getByText('Can you meet at the library?',{exact:true}).waitFor();await buyer.locator('#tcList').getByText('Yes, meet at the north entrance.',{exact:true}).waitFor();await buyer.waitForFunction(()=>[...document.querySelectorAll('#tcList img.img')].some(x=>x.complete&&x.naturalWidth>0));
}));

async function textOverlapsTaskHall(page){return page.evaluate(()=>{const hint=document.querySelector('#officialHint'),button=document.querySelector('#openTaskHall');if(!hint||hint.hidden||!button)return false;const bounds=button.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(hint);return Array.from(range.getClientRects()).some(r=>r.left<bounds.right&&r.right>bounds.left&&r.top<bounds.bottom&&r.bottom>bounds.top)})}
test('mobile task hall button does not cover chat notices',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'AevonEcho',[],{viewport:{width:390,height:844},hasTouch:true});await page.locator('#officialHint').waitFor({state:'visible'});assert.equal(await textOverlapsTaskHall(page),false,'floating task hall button must not cover chat notices');
}));
test('mobile primary navigation wraps every visible action into view',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'AevonEcho',[],{viewport:{width:390,height:844},hasTouch:true});await page.goto(base+'/index.html');await page.locator('header nav a').first().waitFor();
 const nav=await page.evaluate(()=>{const e=document.querySelector('header nav'),box=e.getBoundingClientRect(),links=Array.from(e.querySelectorAll('a')).filter(a=>getComputedStyle(a).display!=='none'),rects=links.map(a=>a.getBoundingClientRect());return {clipped:rects.some(r=>r.left<box.left-1||r.right>box.right+1||r.top<box.top-1||r.bottom>box.bottom+1),rows:new Set(rects.map(r=>Math.round(r.top))).size}});assert.equal(nav.clipped,false,'visible mobile navigation links must not be clipped');assert.ok(nav.rows<=2,'mobile primary navigation should fit within two rows');
}));

test('mobile permission checkboxes respond to taps and preserve drafts across account choice and refresh',t=>fixture(async({base,call})=>{
 const page=await pageFor(t,base,'AevonEcho',[],{hasTouch:true,viewport:{width:390,height:844}});await page.goto(base+'/admin.html');await page.locator('[data-t=roles]').tap();await page.locator('#roleQuery').fill('Bob');await page.locator('input[name=viewUsers]').tap();assert.equal(await page.locator('input[name=viewUsers]').isChecked(),true);
 await page.locator('#roleList [role=status]').filter({hasText:'已勾选 1 项'}).waitFor();await page.locator('#roleQuery').fill('');assert.equal(await page.locator('#roleList form').count(),1);
 const options=await page.locator('#roleSelect option').evaluateAll(es=>es.map(x=>({id:x.value,name:x.textContent})));await page.locator('#roleSelect').selectOption(options.find(x=>x.name.startsWith('Carol')).id);await page.locator('#roleSelect').selectOption(options.find(x=>x.name.startsWith('Bob')).id);assert.equal(await page.locator('input[name=viewUsers]').isChecked(),true);
 await page.evaluate(()=>render());await page.locator('#roleList form').waitFor();assert.equal(await page.locator('input[name=viewUsers]').isChecked(),true);await page.locator('#roleList button[type=submit]').tap();await page.getByRole('status').filter({hasText:'已保存'}).waitFor();assert.deepEqual((await call('/api/me','Bob')).data.permissions,['viewUsers']);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
}));

test('banned login offers contact and administrator replies are visible without granting a normal session',t=>fixture(async({base,call})=>{
 await call('/api/admin/users/Bob/ban','AevonEcho',{reason:'test reason'});const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(5000);t.after(()=>context.close());const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/login.html');await page.locator('#u').fill('Bob');await page.locator('#p').fill(password);await page.locator('#go').click();await page.getByRole('button',{name:'联系管理员 / 申诉',exact:true}).click();
 await page.locator('#supportForm').waitFor();await page.locator('#supportForm textarea').fill('Please review <img src=x onerror=alert(1)>');await page.locator('#supportForm [type=submit]').click();await page.locator('#supportForm [role=status]').filter({hasText:'已发送'}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('token')),null);assert.equal(await page.locator('#supportHistory img').count(),0);
 const admin=await pageFor(t,base,'AevonEcho');await admin.goto(base+'/admin.html');await admin.locator('[data-t=fb]').click();await admin.locator('#fbb [data-a=reply]').waitFor();await admin.locator('#fbb [data-a=reply]').click();await admin.locator('dialog.admin-dialog textarea').fill('Reply <b>reviewed</b>');await admin.locator('dialog.admin-dialog button.primary').click();await admin.waitForFunction(()=>document.querySelector('#fbb')?.textContent.includes('Reply <b>reviewed</b>'));
 await page.getByRole('button',{name:'刷新回复',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#supportHistory')?.textContent.includes('Reply <b>reviewed</b>'));assert.equal(await page.locator('#supportHistory b').filter({hasText:'reviewed'}).count(),0);assert.deepEqual(errors,[]);
}));

test('super administrator grants selected permissions through checkboxes; delegate sees only granted controls',t=>fixture(async({base,call})=>{
 const root=await pageFor(t,base,'AevonEcho');await root.goto(base+'/admin.html');await root.locator('[data-t="roles"]').click();await root.locator('#roleQuery').fill('Bob');
 const list=root.locator('#roleList');assert.equal(await list.locator('input[type=checkbox]').count(),18);
 await list.locator('input[name=viewUsers]').check();await list.getByRole('button',{name:'保存权限',exact:true}).click();await list.getByRole('status').filter({hasText:'已保存'}).waitFor();
 assert.deepEqual((await call('/api/me','Bob')).data.permissions,['viewUsers']);
 const delegate=await pageFor(t,base,'Bob');await delegate.goto(base+'/admin.html');await delegate.locator('#ub').waitFor();assert.equal(await delegate.locator('[data-t=roles]').count(),0);assert.equal(await delegate.locator('[data-t=msgs]').count(),0);assert.equal(await delegate.locator('#bkBtn').count(),0);assert.equal(await delegate.locator('#ub button').count(),0);
 await list.getByRole('button',{name:'撤销全部权限'}).click();await list.getByRole('status').filter({hasText:'已撤销'}).waitFor();
 await delegate.evaluate(()=>render());await delegate.getByRole('heading',{name:'没有权限'}).waitFor();assert.equal((await call('/api/admin/users','Bob')).status,403);
}));

test('delegated point adjustment does not expose administrator grant, message or private chat controls',t=>fixture(async({base,call})=>{
 await setPermissions(call,'Bob',['managePoints']);const page=await pageFor(t,base,'Bob');await page.goto(base+'/admin.html');await page.locator('#ub').waitFor();
 assert.equal(await page.locator('.tabs button').count(),1);assert.equal(await page.locator('#ub button[data-a=points]').count(),2);assert.equal(await page.locator('#ub button[data-a=ban]').count(),0);assert.equal(await page.locator('#ub button[data-a=delete]').count(),0);
 await page.goto(base+'/index.html');await page.waitForFunction(()=>isAdmin===true);assert.equal(await page.locator('#annForm').isVisible(),false);assert.equal(await page.locator('#adminLink').isVisible(),true);
}));

test('message viewer cannot delete or intervene and dispute handler cannot open private chats',t=>fixture(async({base,call,task,act})=>{
 const m=await task();await act(m,'Carol','claim');await act(m,'Alice','dispute',{reason:'test evidence'});
 await setPermissions(call,'Bob',['viewMessages']);const page=await pageFor(t,base,'Bob');await page.goto(base+'/admin.html');await page.locator('#mb tr').waitFor();
 assert.equal(await page.locator('#mb [data-c]').count(),0);assert.equal(await page.locator('#mb [data-force]').count(),0);assert.equal(await page.locator('#mb [data-chat]').count(),0);
 await setPermissions(call,'Bob',['manageDisputes']);await page.reload();await page.locator('#dsb tr').waitFor();assert.equal(await page.locator('#dsb [data-chat]').count(),0);assert.ok(await page.locator('#dsb [data-force]').count()>0);
}));

test('task composer no longer exposes points reward input',t=>fixture(async({base,call})=>{
 await setPermissions(call,'Bob',['publishBonus']);const page=await pageFor(t,base,'Bob');await page.locator('#postBtn').click();
 assert.equal(await page.locator('#bonusF,#xBonus').count(),0);
 for(const id of ['xReward','xPlace','xDeadline'])assert.equal(await page.locator('#'+id).count(),1);
 await page.locator('#isTaskL').waitFor({state:'hidden'});
}));
test('permission editor fits desktop and mobile and keeps super administrator immutable',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'AevonEcho');await page.goto(base+'/admin.html');await page.locator('[data-t=roles]').click();await page.locator('#roleQuery').fill('Bob');await page.locator('#roleList form').waitFor();
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.review/permissions-desktop.jpg'});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.review/permissions-mobile.jpg',fullPage:true});
 await page.locator('#roleQuery').fill('AevonEcho');assert.equal(await page.locator('#roleList input[type=checkbox]').count(),0);assert.equal(await page.locator('#roleList button').count(),0);
}));
test('logout removes open private chat and previous-account state',t=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Bob','claim');await call('/api/tasks/'+m.id+'/chat','Alice',{text:'private Bob evidence'});
 const page=await pageFor(t,base);await page.locator('[data-chat="'+m.id+'"]').click();await page.getByText('private Bob evidence',{exact:true}).waitFor();
 await Promise.all([page.waitForEvent('load'),page.locator('#out').click()]);assert.equal(await page.locator('#tc').evaluate(e=>e.classList.contains('show')),false);
 assert.equal(await page.locator('#tcList').textContent(),'');assert.equal(await page.evaluate(()=>tc),null);
 assert.equal(await page.evaluate(()=>ratedLocal.size),0);
}));
test('switching accounts reloads personalized tasks and clears per-user ratings',t=>fixture(async({base,task,act})=>{
 const m=await task();await act(m,'Bob','offer',{price:15});const page=await pageFor(t,base);
 await page.waitForFunction(id=>(cache[cur]||[]).some(x=>x.id===id&&x.myOffer),m.id);
 await page.evaluate(id=>ratedLocal.add(String(id)),m.id);await Promise.all([page.waitForEvent('load'),page.locator('#out').click()]);await page.locator('#lu').fill('Carol');await page.locator('#lp').fill(password);await Promise.all([page.waitForEvent('load'),page.locator('#bGo').click()]);
 await page.waitForFunction(()=>me==='Carol'&&online===true&&points!==null);
 assert.equal(await page.evaluate(id=>!!(cache[cur]||[]).find(x=>x.id===id)?.myOffer,m.id),false);
 assert.equal(await page.evaluate(id=>ratedLocal.has(String(id)),m.id),false);
}));
test('late account response cannot restore admin UI after logout',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'AevonEcho');let release,arrived;
 const waiting=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);
 await page.route('**/api/me',async route=>{arrived();await gate;await route.fulfill({status:200,json:{username:'AevonEcho',admin:true,banned:false,points:0}})});
 await page.evaluate(()=>loadMe());await waiting;await Promise.all([page.waitForEvent('load'),page.locator('#out').click()]);release();await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>isAdmin),false);assert.equal(await page.evaluate(()=>token),null);
}));
test('out-of-order channel refresh cannot overwrite a newer task or revision',t=>fixture(async({base,task})=>{
 const m=await task(),page=await pageFor(t,base);let release,arrived,calls=0;
 const waiting=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);
 await page.waitForFunction(()=>!refreshInFlight&&!refreshPending);
 await page.route('**/messages?rev=*',async route=>{const older=++calls===1;if(older){arrived();await gate}await route.fulfill({status:200,headers:{'X-Rev':older?'101':'102'},json:[{...m,text:older?'older':'newer',rev:older?101:102}]})});
 const old=page.evaluate(()=>refresh());await waiting;await page.evaluate(()=>refresh());release();await old;await page.waitForFunction(id=>cache[cur].find(x=>x.id===id)?.text==='newer'&&revs[cur]===102,m.id);
 assert.equal(await page.evaluate(id=>cache[cur].find(x=>x.id===id).text,m.id),'newer');assert.equal(await page.evaluate(()=>revs[cur]),102);
}));
test('a searched task outside the recent page opens its private chat',async t=>{
 const data=seed(),now=Date.now(),id=now*1000;data.rev=60;data.messages['校园跑']=Array.from({length:60},(_,i)=>({id:id+i,user:'Alice',text:i===0?'unique historical task':'recent task '+i,task:true,claimedBy:i===0?'Bob':undefined,time:new Date(now+i).toISOString(),rev:i+1}));
 await fixture(async({base})=>{const page=await pageFor(t,base);assert.equal(await page.evaluate(id=>!!(cache[cur]||[]).find(x=>x.id===id),id),false);
  await page.route('**/messages?before=*',route=>route.abort());await page.locator('#q').fill('unique historical task');await page.locator('[data-chat="'+id+'"]').waitFor();await page.locator('[data-chat="'+id+'"]').click();
  assert.equal(await page.locator('#tc').evaluate(e=>e.classList.contains('show')),true);assert.equal(await page.evaluate(()=>tc?.id),String(id));
 },data);
});
test('ordinary decimal prices such as 0.29 and 1.10 are accepted',t=>fixture(async({base})=>{
 const page=await pageFor(t,base);for(const value of ['0.29','1.10','2.30','19.99'])assert.equal(await page.evaluate(v=>priceOk(v),value),true,value);
 for(const value of ['0.001','1.234','0','100001'])assert.equal(await page.evaluate(v=>priceOk(v),value),false,value);
}));
test('account change in another tab clears chat, personal center and admin views',t=>fixture(async({base})=>{
 const chat=await pageFor(t,base,'AevonEcho'),context=chat.context(),admin=await context.newPage(),me=await context.newPage(),trigger=await context.newPage();
 await admin.goto(base+'/admin.html');await admin.getByRole('button',{name:'👥 用户',exact:true}).waitFor();await me.goto(base+'/me.html');await me.getByRole('heading',{name:'👤 AevonEcho'}).waitFor();await trigger.goto(base+'/index.html');
 const reloaded=Promise.all([chat.waitForEvent('load'),admin.waitForEvent('load'),me.waitForEvent('load')]);
 await trigger.evaluate(()=>{localStorage.setItem('username','Bob');localStorage.setItem('admin','0');localStorage.setItem('token','Bob')});await reloaded;
 await chat.waitForFunction(()=>token==='Bob'&&me==='Bob');await admin.getByRole('heading',{name:'没有权限'}).waitFor();await me.getByRole('heading',{name:'👤 Bob'}).waitFor();
 assert.equal(await admin.getByRole('button',{name:'👥 用户',exact:true}).count(),0);
}));
test('corrupted saved read markers do not break the channel page and markers are per account',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'Bob',[{name:'lastRead:Bob',value:'{broken'}]);assert.equal(await page.evaluate(()=>seenKey),'lastRead:Bob');assert.equal(await page.locator('#title').textContent(),'# 任务大厅');
 await Promise.all([page.waitForEvent('load'),page.locator('#out').click()]);assert.equal(await page.evaluate(()=>seenKey),'lastRead:guest');
}));
test('double submission publishes a single task and deducts points once',t=>fixture(async({base,call})=>{
 const page=await pageFor(t,base);assert.equal(await page.locator('#text').getAttribute('maxlength'),'2000');await page.locator('#postBtn').click();await page.locator('#text').fill('single task');let release,arrived,calls=0;
 const gate=new Promise(r=>release=r),waiting=new Promise(r=>arrived=r);
 await page.route('**/messages',async route=>{if(route.request().method()!=='POST')return route.continue();calls++;arrived();await gate;await route.continue()});
 const first=page.evaluate(()=>f.onsubmit({preventDefault(){}}));await waiting;await page.evaluate(()=>f.onsubmit({preventDefault(){}}));assert.equal(calls,1);assert.equal(await page.locator('#send').isDisabled(),true);release();await first;
 const tasks=(await call('/api/my/tasks','Bob')).data.posted;assert.equal(tasks.filter(x=>x.text==='single task').length,1);assert.equal((await call('/api/my/points','Bob')).data.points,99);
}));
test('late admin tab response cannot overwrite the current tab',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'AevonEcho');await page.goto(base+'/admin.html');await page.locator('#ub').waitFor();let release,arrived;
 const gate=new Promise(r=>release=r),waiting=new Promise(r=>arrived=r);
 await page.route('**/api/admin/chats',async route=>{arrived();await gate;await route.fulfill({status:200,json:[]})});
 await page.locator('[data-t="chats"]').click();await waiting;await page.locator('[data-t="fb"]').click();await page.locator('#fbb').waitFor();release();await page.waitForTimeout(100);
 assert.equal(await page.locator('#fbb').count(),1);assert.equal(await page.locator('#cb').count(),0);
}));
test('admin settings use a compact summary and never download the message list',t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'AevonEcho');await page.goto(base+'/admin.html');await page.locator('#ub').waitFor();const paths=[];
 page.on('request',r=>{if(r.url().includes('/api/admin/'))paths.push(new URL(r.url()).pathname+new URL(r.url()).search)});
 await page.locator('[data-t="set"]').click();await page.locator('#sf').waitFor();assert.ok(paths.includes('/api/admin/overview?summary=1'));assert.ok(!paths.includes('/api/admin/overview'));assert.ok(!paths.includes('/api/admin/messages'));
}));
test('admin can accept an offer on their own task',t=>fixture(async({base,task,act,call})=>{
 const m=await task('AevonEcho');await act(m,'Bob','offer',{price:15});const page=await pageFor(t,base,'AevonEcho');await page.locator('[data-of="'+m.id+'"]').click();await page.locator('#pop .ofP').waitFor();
 assert.equal(await page.getByRole('button',{name:'同意 15 元',exact:true}).count(),1);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'同意 15 元',exact:true}).click();await page.locator('#pop').waitFor({state:'hidden'});
 assert.equal((await call('/api/admin/messages','AevonEcho')).data.find(x=>x.id===m.id).claimedBy,'Bob');
}));
test('admin observing other users offers is shown the actual parties and remains read only',t=>fixture(async({base,task,act})=>{
 const m=await task();await act(m,'Bob','offer',{price:15});const page=await pageFor(t,base,'AevonEcho');await page.locator('[data-of="'+m.id+'"]').click();await page.locator('#pop .ofP').waitFor();
 assert.equal(await page.locator('#pop').getByText('轮到你回复',{exact:true}).count(),0);assert.equal(await page.locator('#pop').getByText('等发布人回复',{exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'同意 15 元',exact:true}).count(),0);assert.ok(!(await page.locator('#pop .ofH').textContent()).includes('claimer'));
}));
test('participants can load private chat images and open the preview',t=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Bob','claim');
 const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII=';
 assert.equal((await call('/api/tasks/'+m.id+'/chat/image','Alice',{data:image})).status,200);
 const page=await pageFor(t,base,'Bob');await page.goto(base+'/chat.html?task='+m.id+'#'+encodeURIComponent('校园跑'));
 const img=page.locator('#tcList img.img');await img.waitFor();await page.waitForFunction(()=>{const i=document.querySelector('#tcList img.img');return i&&i.complete&&i.naturalWidth>0});
 await img.click();await page.locator('#lb.show img').waitFor();
 assert.ok(await page.locator('#lb img').evaluate(i=>i.naturalWidth>0));
}));
test('admin chat releases image object URLs when its dialog closes',t=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Bob','claim');await call('/api/tasks/'+m.id+'/chat/image','Bob',{data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII='});
 const page=await pageFor(t,base,'AevonEcho');await page.goto(base+'/admin.html');await page.locator('#ub').waitFor();
 await page.evaluate(()=>{window.createdUrls=[];window.revokedUrls=[];const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);createdUrls.push(u);return u};URL.revokeObjectURL=u=>{revokedUrls.push(u);revoke(u)}});
 await page.evaluate(id=>openChat(id,'test'),m.id);await page.waitForFunction(()=>createdUrls.length===1);await page.locator('.cm h3 button').click();
 assert.deepEqual(await page.evaluate(()=>revokedUrls),await page.evaluate(()=>createdUrls));
}));
test('closing a private chat before an image arrives does not leak a late object URL',t=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Bob','claim');await call('/api/tasks/'+m.id+'/chat/image','Alice',{data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII='});const page=await pageFor(t,base);
 await page.evaluate(()=>{window.createdUrls=[];const create=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{const u=create(b);createdUrls.push(u);return u}});let arrived,release;const waiting=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);
 await page.route('**/chat/image/*',async route=>{arrived();await gate;await route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgo=','base64')})});
 await page.locator('[data-chat="'+m.id+'"]').click();await waiting;await page.locator('#tcX').click();release();await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>createdUrls.length),0);
}));
test('admin can page beyond 500 messages, search and delete an old task with a refund',async t=>{
 const data=seed(),id=Date.now()*1000;data.messages['校园跑']=Array.from({length:501},(_,i)=>({id:id+i,user:'Alice',text:'message-'+i,task:true,cost:1,time:new Date().toISOString()}));
 await fixture(async({base,call})=>{const page=await pageFor(t,base,'AevonEcho');await page.goto(base+'/admin.html');await page.locator('#ub').waitFor();await page.locator('[data-t="msgs"]').click();await page.locator('#mb tr').first().waitFor();
  assert.equal(await page.getByRole('button',{name:'末页',exact:true}).count(),1);assert.equal(await page.locator('#mb tr').count(),50);await page.getByRole('button',{name:'末页',exact:true}).click();await page.waitForFunction(()=>document.getElementById('mcnt').textContent.includes('11/11'));
  assert.ok((await page.locator('#mb').textContent()).includes('message-0'));await page.locator('#mb button[data-c]').click();await page.locator('#cfP').check();await page.locator('#cfGo').click();await page.locator('#cfGo').waitFor({state:'hidden'});
  await page.locator('#mq').fill('message-0');await page.locator('#mf').selectOption('gone');await page.waitForFunction(()=>document.getElementById('mcnt').textContent.includes('共 1 条'));
  assert.ok((await page.locator('#mb').textContent()).includes('message-0'));assert.ok((await page.locator('#mb').textContent()).includes('已删除'));assert.equal((await call('/api/my/points','Alice')).data.points,101);
 },data);
});
test('admin message rows retain access to withdrawn offer history',t=>fixture(async({base,task,act,call})=>{
 const m=await task(),offer=(await act(m,'Bob','offer',{price:15,note:'history note'})).data.offer;await call('/api/channels/'+encodeURIComponent('校园跑')+'/messages/'+m.id+'/offers/'+offer.id+'/withdraw','Bob',{});
 const page=await pageFor(t,base,'AevonEcho');await page.goto(base+'/admin.html');await page.locator('#ub').waitFor();await page.locator('[data-t="msgs"]').click();await page.locator('[data-off="'+m.id+'"]').click();await page.locator('.cm .ci').waitFor();assert.ok((await page.locator('.cm .cl').textContent()).includes('history note'));
}));

test('task hall exposes all task types without type filters and opens a claimed order on mobile',async t=>{
 const data=seed(),id=1234567890200000;data.messages['校园跑']=Array.from({length:21},(_,i)=>({id:id+i,user:'Alice',task:true,text:'hall task '+i,time:new Date().toISOString()}));data.messages['代取快递']=[{id:id+30,user:'Alice',task:true,text:'hall parcel',time:new Date().toISOString()}];
 await fixture(async({base})=>{
 const page=await pageFor(t,base,'Bob',[],{viewport:{width:390,height:844},hasTouch:true});
 await page.goto(base+'/index.html');assert.ok(await page.locator('#openTaskHall').evaluate(el=>el.closest('.hero-tools')&&getComputedStyle(el).position==='static'));assert.ok(await page.locator('#fbBtn,#supportBtn').evaluateAll(es=>es.length===2&&es.every(e=>e.closest('.hero-tools')&&getComputedStyle(e).position==='static')));assert.equal(await page.locator('header a[href="chat.html#任务大厅"]').count(),1);await page.locator('#openTaskHall').click();await page.getByText('共 22 个待接任务 · 每页 20 条',{exact:true}).waitFor();
 assert.equal(await page.locator('.card').count(),20);await page.getByRole('button',{name:'下一页'}).click();await page.getByText('2 / 2',{exact:true}).waitFor();assert.equal(await page.locator('.card').count(),2);
 await page.locator('#prev').click();await page.getByText('1 / 2',{exact:true}).waitFor();assert.equal(await page.locator('#channel').count(),0);await page.getByRole('heading',{name:'hall parcel',exact:true}).waitFor();
 await page.locator('#query').fill('hall task 0');await page.getByRole('button',{name:'查找',exact:true}).click();await page.getByText('共 1 个待接任务 · 每页 20 条',{exact:true}).waitFor();await page.getByRole('heading',{name:'hall task 0',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'接单（扣 1 积分）',exact:true}).click();await page.waitForURL(/chat\.html\?task=/);await page.locator('#tc.show').waitFor();
 },data);
});

test('unified task hall, free chat and legacy channel bookmark',t=>fixture(async({base,call})=>{
 const page=await pageFor(t,base,'Bob');await page.goto(base+'/index.html');await page.getByRole('heading',{name:'任务大厅',exact:true}).waitFor();await page.getByRole('heading',{name:'校园聊天',exact:true}).waitFor();assert.equal(await page.locator('#channels .card').count(),2);
 await page.goto(base+'/chat.html#'+encodeURIComponent('食堂配送'));await page.waitForFunction(()=>cur==='任务大厅'&&online===true);assert.equal(await page.locator('#title').innerText(),'# 任务大厅');assert.equal(await page.locator('#taskFilter').count(),0);assert.equal(await page.locator('#xType').inputValue(),'校园配送');
 await page.goto(base+'/chat.html#'+encodeURIComponent('校园聊天'));await page.waitForFunction(()=>cur==='校园聊天'&&online===true);await page.locator('#chatHint').waitFor({state:'visible'});assert.equal(await page.locator('#sbar').isVisible(),false);assert.equal((await page.locator('#bal').innerText()).trim(),'');const points=(await call('/api/my/points','Bob')).data.points;await page.locator('#text').fill('campus chat is free');await page.locator('#send').click();await page.locator('.m').filter({hasText:'campus chat is free'}).waitFor();assert.equal((await call('/api/my/points','Bob')).data.points,points);
}));

test('home navigation is ordered for common actions and leaderboard has clear exits',async t=>fixture(async({base})=>{
 const page=await pageFor(t,base,'Bob');await page.goto(base+'/index.html');
 const labels=await page.locator('header nav a').evaluateAll(xs=>xs.map(x=>x.textContent.trim().replace(/\s*\d+$/,'')));
 assert.deepEqual(labels.slice(0,4),['功能入口','任务大厅','接单排行榜','我的订单 / 个人中心']);
 await page.goto(base+'/leaderboard.html');
 await page.getByRole('link',{name:'返回首页',exact:true}).waitFor();
 await page.getByRole('link',{name:'可接任务',exact:true}).waitFor();
 await page.getByRole('link',{name:'我的订单 / 个人中心',exact:true}).waitFor();
 await page.goto(base+'/chat.html#'+encodeURIComponent('校园跑'));
 await page.waitForFunction(()=>online===true);
 assert.equal(await page.locator('#bonusF').count(),0);
}));
test('home announcements show two by default and keep explicit expansion across refresh',async t=>{
 const data=seed();data.announcements=Array.from({length:4},(_,i)=>({id:1234567890600000+i,user:'AevonEcho',title:'Notice '+i,text:'Body '+i,time:new Date(Date.now()+i*1000).toISOString()}));
 await fixture(async({base,call})=>{
  const page=await pageFor(t,base,'Bob');await page.goto(base+'/index.html');await page.getByRole('button',{name:'查看更多公告（还有 2 条）',exact:true}).waitFor();assert.equal(await page.locator('#annList li').count(),2);
  await page.locator('#annMore').click();assert.equal(await page.locator('#annList li').count(),4);assert.equal(await page.locator('#annMore').getAttribute('aria-expanded'),'true');
  await page.evaluate(()=>loadAnn());assert.equal(await page.locator('#annList li').count(),4);await page.getByRole('button',{name:'收起公告',exact:true}).click();assert.equal(await page.locator('#annList li').count(),2);
  for(const a of data.announcements.slice(0,2))await call('/api/announcements/'+a.id+'/delete','AevonEcho',{});
  await page.evaluate(()=>loadAnn());assert.equal(await page.locator('#annList li').count(),2);assert.equal(await page.locator('#annMore').isVisible(),false);
 },data);
});


test('weekly rewards keep private per-period uploads and require admin review before recording payout',async t=>{
 const data=seed(),day=86400000,now=Date.now(),local=new Date(now+8*3600000),monday=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-(local.getUTCDay()+6)%7,1)-8*3600000,start=(monday>now?monday-7*day:monday)-7*day;
 const makePeriod=at=>({key:new Date(at+8*3600000).toISOString().slice(0,10),startAt:new Date(at).toISOString(),endAt:new Date(at+6*day).toISOString(),createdAt:new Date(at+6*day).toISOString(),pointsSent:true,rows:[{username:'Bob',userId:'account-Bob',rank:1,count:25,cash:10,points:0,eligible:true,status:'waiting_qr'},{username:'Carol',userId:'account-Carol',rank:2,count:22,cash:5,points:0,eligible:true,status:'waiting_qr'}]});
 const older=makePeriod(start-7*day),latest=makePeriod(start);data.weeklyRewards=[older,latest];
 await fixture(async({base,call,tmp})=>{
  const winner=await pageFor(t,base,'Bob',[],{viewport:{width:320,height:780},hasTouch:true});await winner.goto(base+'/leaderboard.html');await winner.locator('[data-qr="'+latest.key+'"]').waitFor();assert.equal(await winner.locator('[data-qr]').count(),2,'all unpaid periods remain accessible');assert.ok(await winner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'leaderboard fits 320px');await winner.getByText('我的其他待领取奖励',{exact:true}).waitFor();
  await winner.route('**/api/leaderboard',r=>r.fulfill({status:503,json:{error:'Temporary leaderboard failure'}}));await winner.getByRole('button',{name:'刷新排行榜',exact:true}).click();await winner.getByText('当前保留上次读取的榜单。',{exact:false}).waitFor();assert.equal(await winner.locator('[data-qr]').count(),2);await winner.unroute('**/api/leaderboard');
  const outsider=await pageFor(t,base,'Alice');await outsider.goto(base+'/leaderboard.html');await outsider.locator('#content .row').first().waitFor();assert.equal(await outsider.locator('[data-qr]').count(),0,'other users cannot see winner upload controls');
  await winner.locator('[data-qr="'+latest.key+'"]').click();await winner.getByRole('dialog',{name:'提交奖励收款码'}).waitFor();const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');await winner.locator('#qrFile').setInputFiles({name:'saved-receipt.png',mimeType:'image/png',buffer:png});
  const [submitted]=await Promise.all([winner.waitForResponse(r=>r.url().includes('/api/my/weekly-reward/qr?period=')&&r.request().method()==='POST'),winner.getByRole('button',{name:'确认提交收款码',exact:true}).click()]);assert.equal(submitted.status(),200);assert.equal(new URL(submitted.url()).searchParams.get('period'),latest.key);await winner.getByRole('dialog',{name:'提交奖励收款码'}).waitFor({state:'hidden'});
  const periods=(await call('/api/admin/weekly-rewards','AevonEcho')).data,record=periods.find(p=>p.key===latest.key).rows.find(r=>r.username==='Bob');assert.ok(record.qrVersion);assert.deepEqual(await require('node:fs/promises').readFile(require('node:path').join(tmp,'weekly-reward-qr',record.qrVersion+'.png')),png,'original image bytes are preserved');assert.equal(periods.find(p=>p.key===older.key).rows.find(r=>r.username==='Bob').hasQr,false,'selected period receives the file');
  const admin=await pageFor(t,base,'AevonEcho',[],{viewport:{width:320,height:780},hasTouch:true});await admin.goto(base+'/admin.html');await admin.locator('[data-t="rewards"]').click();await admin.locator('#weeklyPeriod').waitFor();await admin.locator('#weeklyPeriod').selectOption(latest.key);assert.equal(await admin.locator('[data-paid="account-Bob"]').isDisabled(),true,'admin must view the code first');assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'reward admin fits 320px');
  const [viewed]=await Promise.all([admin.waitForResponse(r=>r.url().includes('/account-Bob/qr?version=')),admin.locator('[data-view-qr="account-Bob"]').click()]);assert.equal(viewed.status(),200);assert.equal(new URL(viewed.url()).searchParams.get('version'),record.qrVersion);const modal=admin.getByRole('dialog',{name:'获奖者收款码'});await modal.waitFor();await modal.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await admin.locator('[data-paid="account-Bob"]').isEnabled(),true);
  await admin.locator('[data-paid="account-Bob"]').click();const [paid]=await Promise.all([admin.waitForResponse(r=>r.url().endsWith('/account-Bob/paid')&&r.request().method()==='POST'),admin.locator('dialog.admin-dialog').getByRole('button',{name:'确认已转账'}).click()]);assert.equal(paid.status(),200);assert.equal(paid.request().postDataJSON().qrVersion,record.qrVersion);await admin.locator('#weeklyRows').getByText('已登记打款',{exact:false}).waitFor();assert.equal((await call('/api/admin/weekly-rewards','AevonEcho')).data.find(p=>p.key===latest.key).rows.find(r=>r.username==='Bob').status,'paid');
  await winner.getByRole('button',{name:'刷新排行榜',exact:true}).click();await winner.locator('[data-qr="'+latest.key+'"]').waitFor({state:'detached'});await winner.getByText('已登记打款',{exact:true}).waitFor();assert.equal(await winner.locator('[data-qr]').count(),1,'older unpaid reward is still available after latest is paid');
 },data);
});
