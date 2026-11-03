// Optional browser tests: supply PLAYWRIGHT_MODULE if Playwright is installed outside this project.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {fixture,password,sleep,seed}=require('./helpers.cjs');
let browser;
before(async()=>{browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined),headless:true})});
after(async()=>{if(browser)await browser.close()});
async function setPermissions(call,name,permissions){const d=(await call('/api/admin/roles','AevonEcho')).data,u=d.users.find(x=>x.username===name);const r=await call(`/api/admin/users/${name}/permissions`,'AevonEcho',{permissions,userId:u.userId,version:u.permissionsVersion});assert.equal(r.status,200)}
async function pageFor(t,base,user='Bob',extraStorage=[],options={}){
 const context=await browser.newContext({...options,storageState:{cookies:[],origins:[{origin:base,localStorage:[{name:'token',value:user},{name:'username',value:user},{name:'admin',value:user==='AevonEcho'?'1':'0'},...extraStorage]}]}}),page=await context.newPage(),errors=[];
 t.after(async()=>{await context.close();assert.deepEqual(errors,[],'uncaught browser errors')});
 page.on('pageerror',e=>errors.push(e.message));
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await page.goto(base+'/chat.html#'+encodeURIComponent('校园跑'));await page.waitForFunction(()=>online===true&&points!==null);
 return page;
}

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
 const admin=await pageFor(t,base,'AevonEcho');await admin.goto(base+'/admin.html');await admin.locator('[data-t=fb]').click();await admin.locator('#fbb [data-a=reply]').waitFor();admin.once('dialog',d=>d.accept('Reply <b>reviewed</b>'));await admin.locator('#fbb [data-a=reply]').click();await admin.waitForFunction(()=>document.querySelector('#fbb')?.textContent.includes('Reply <b>reviewed</b>'));
 await page.getByRole('button',{name:'刷新回复',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#supportHistory')?.textContent.includes('Reply <b>reviewed</b>'));assert.equal(await page.locator('#supportHistory b').filter({hasText:'reviewed'}).count(),0);assert.deepEqual(errors,[]);
}));

test('super administrator grants selected permissions through checkboxes; delegate sees only granted controls',t=>fixture(async({base,call})=>{
 const root=await pageFor(t,base,'AevonEcho');await root.goto(base+'/admin.html');await root.locator('[data-t="roles"]').click();await root.locator('#roleQuery').fill('Bob');
 const list=root.locator('#roleList');assert.equal(await list.locator('input[type=checkbox]').count(),16);
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

test('bonus-only administrator pays normal fees and gets no official message composer',t=>fixture(async({base,call})=>{
 await setPermissions(call,'Bob',['publishBonus']);const page=await pageFor(t,base,'Bob');assert.equal(await page.locator('#f').isVisible(),false);await page.locator('#postBtn').click();assert.equal(await page.locator('#xBonus').isVisible(),true);assert.equal(await page.locator('#isTaskL').isVisible(),false);
 await page.locator('#text').fill('delegated bonus task');await page.locator('#xBonus').fill('2');await page.locator('#send').click();await page.waitForFunction(()=>points===99);
 const d=(await call('/api/my/tasks','Bob')).data.posted[0];assert.equal(d.bonusPoints,2);assert.equal(d.official,undefined);assert.equal(d.cost,1);
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
 await page.route('**/messages?rev=*',async route=>{const older=++calls===1;if(older){arrived();await gate}await route.fulfill({status:200,headers:{'X-Rev':older?'101':'102'},json:[{...m,text:older?'older':'newer',rev:older?101:102}]})});
 const old=page.evaluate(()=>refresh());await waiting;await page.evaluate(()=>refresh());release();await old;
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
 const page=await pageFor(t,base,'Bob',[{name:'lastRead:Bob',value:'{broken'}]);assert.equal(await page.evaluate(()=>seenKey),'lastRead:Bob');assert.equal(await page.locator('#title').textContent(),'# 校园跑');
 await Promise.all([page.waitForEvent('load'),page.locator('#out').click()]);assert.equal(await page.evaluate(()=>seenKey),'lastRead:guest');
}));
test('double submission publishes a single task and deducts points once',t=>fixture(async({base,call})=>{
 const page=await pageFor(t,base);await page.locator('#postBtn').click();await page.locator('#text').fill('single task');let release,arrived,calls=0;
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
