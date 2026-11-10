const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const format={date:()=>'',status:x=>x||'待接单'};
function harness(relative,api,dataOverrides,wxOverrides){
  let definition;
  const wx=Object.assign({
    getStorageSync:key=>key==='token'?'token':'',
    showToast(){},showModal(options){wx.lastModal=options},
    navigateTo(options){wx.lastNavigation=options},redirectTo(options){wx.lastNavigation=options},
    downloadFile(){},chooseMedia(){},getFileSystemManager(){return {readFile(){}}}
  },wxOverrides||{});
  const filename=path.join(root,relative);
  const source=fs.readFileSync(filename,'utf8');
  const context={Page(value){definition=value},wx,getApp(){return {globalData:{apiBase:'https://plgslzlexpmy.sealoshzh.site'},clearSession(){wx.clearSessionCalls=(wx.clearSessionCalls||0)+1}}},require(name){return name.includes('api')?api:format},setInterval(){return 1},clearInterval(){},getCurrentPages(){return [{}]},console};
  vm.runInNewContext(source,context,{filename});
  const page=Object.assign({},definition,{data:Object.assign({},definition.data,dataOverrides||{}),setData(value){Object.assign(this.data,value)}});
  return {page,wx};
}
function apiStub(handlers){
  const calls=[];
  const api={
    calls,
    async get(path){calls.push(['get',path]);if(handlers.get)return handlers.get(path);throw new Error('unexpected GET '+path)},
    async post(path,data,options){calls.push(['post',path,data,options]);if(handlers.post)return handlers.post(path,data,options);return {}},
    async request(path,options){calls.push(['request',path,options]);if(handlers.request)return handlers.request(path,options);return {data:{task:{canWrite:false},messages:[]},header:{}}},
    requireLogin(){return handlers.requireLogin?handlers.requireLogin():true},handleAuthError(error){return handlers.handleAuthError?handlers.handleAuthError(error):false}
  };
  return api;
}

function appHarness(pages,wxOverrides){
  let definition;
  const wx=Object.assign({getStorageSync(){return ''},setStorageSync(){},removeStorageSync(){}},wxOverrides||{});
  vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),{App(value){definition=value},wx,getCurrentPages(){return pages||[]},console});
  definition.onLaunch();
  return {app:definition,wx};
}

function privacyComponentHarness(){
  let definition;
  const wx={openPrivacyContract(options){if(options.success)options.success({})},showToast(){}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'components/privacy-popup/index.js'),'utf8'),{Component(value){definition=value},wx,console});
  const component=Object.assign({},definition,definition.methods,{data:Object.assign({},definition.data),setData(value){Object.assign(this.data,value)}});
  return {component,wx};
}

test('native privacy requests are routed to the active page prompt and fail closed without one',()=>{
  let listener,forwarded;
  const page={selectComponent(selector){assert.equal(selector,'#privacyPopup');return {requestAuthorization(resolve){forwarded=resolve}}}};
  appHarness([page],{onNeedPrivacyAuthorization(fn){listener=fn}});
  const results=[];listener(result=>results.push(result));forwarded({event:'agree'});
  assert.equal(results[0].event,'agree');
  let missingListener;
  appHarness([],{onNeedPrivacyAuthorization(fn){missingListener=fn}});
  const missing=[];missingListener(result=>missing.push(result));
  assert.equal(missing[0].event,'disagree');
});

test('privacy popup opens the platform contract and resolves only after an explicit choice',()=>{
  const {component}=privacyComponentHarness(),results=[];
  component.requestAuthorization(result=>results.push(result));
  assert.equal(component.data.visible,true);
  component.openContract();
  component.agree({detail:{buttonId:'privacy-agree'}});
  assert.equal(component.data.visible,false);
  assert.equal(results[0].event,'agree');
  assert.equal(results[0].buttonId,'privacy-agree');
  component.requestAuthorization(result=>results.push(result));
  component.disagree();
  assert.equal(results[1].event,'disagree');
});

test('login requires explicit agreement before sending credentials',async()=>{
  const api=apiStub({post:async()=>{throw new Error('must not call')}});
  const {page}=harness('pages/login/login.js',api);
  page.setData({username:'student',password:'secret12'});
  await page.submit();
  assert.match(page.data.error,/同意/);
  assert.equal(api.calls.length,0);
});

test('accepting the login agreement clears the stale consent error',()=>{
  const {page}=harness('pages/login/login.js',apiStub({}));
  for(const error of ['请先阅读并同意用户协议与隐私说明','请先确认用户协议：勾选复选框']){
    page.setData({agreed:false,error});page.onAgreement({detail:{value:['agree']}});
    assert.equal(page.data.agreed,true);assert.equal(page.data.error,'');
  }
});

test('explicit consent at the end of the legal page returns to login with agreement saved',()=>{
  const login={route:'pages/login/login',data:{agreed:false,error:'请先确认用户协议'},setData(value){Object.assign(this.data,value)}};let definition,returned;
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/legal/legal.js'),'utf8'),{Page(value){definition=value},require(){return apiStub({})},getCurrentPages(){return [login,{}]},wx:{navigateBack(value){returned=value}}});
  const page=Object.assign({},definition,{data:Object.assign({},definition.data),setData(value){Object.assign(this.data,value)}});page.agreeAndReturn();
  assert.equal(login.data.agreed,true);assert.equal(login.data.error,'');assert.equal(returned.delta,1);
});

test('task hall hides claim availability when fee rules cannot be read',async()=>{
  const api=apiStub({get:async path=>{
    if(path.startsWith('/api/tasks?'))return {tasks:[],total:0,pages:1};
    if(path==='/api/settings')throw new Error('settings unavailable');
  }});
  const {page}=harness('pages/tasks/tasks.js',api);
  await page.load();
  assert.equal(page.data.feeReady,false);
  assert.equal(page.data.claimCost,null);
  assert.match(page.data.error,/settings unavailable/);
});

test('task claim rechecks balance and fee before opening a confirmation dialog',async()=>{
  const api=apiStub({get:async()=>({claimCost:3,points:3})});
  const {page,wx}=harness('pages/tasks/tasks.js',api);
  page.sessionToken='token';page.sessionUsername='';
  await page.claim({currentTarget:{dataset:{id:'12',channel:'校园跑'}}});
  assert.match(wx.lastModal.content,/扣除 3 积分/);
  assert.equal(api.calls.filter(x=>x[0]==='post').length,0);
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls.find(x=>x[0]==='post')[1],'/api/channels/%E6%A0%A1%E5%9B%AD%E8%B7%91/messages/12/claim');
});

test('task claim stops when the live balance is missing',async()=>{
  const api=apiStub({get:async()=>({claimCost:2})});
  const {page,wx}=harness('pages/tasks/tasks.js',api,{}, {showToast(options){wx.lastToast=options}});
  page.sessionToken='token';page.sessionUsername='';
  await page.claim({currentTarget:{dataset:{id:'12',channel:'校园跑'}}});
  assert.equal(wx.lastModal,undefined);
  assert.equal(api.calls.some(x=>x[0]==='post'),false);
  assert.match(wx.lastToast.title,/积分余额/);
});

test('task hall claim confirmation cannot spend a different account balance',async()=>{
  let token='session-a',username='worker';
  const api=apiStub({get:async path=>path==='/api/me'?{claimCost:2,points:5}:path==='/api/settings'?{claimCost:2}:{tasks:[],total:0,pages:1}});
  const {page,wx}=harness('pages/tasks/tasks.js',api,{}, {getStorageSync:key=>key==='token'?token:username,showToast(options){wx.lastToast=options}});
  page.sessionToken=token;page.sessionUsername=username;
  await page.claim({currentTarget:{dataset:{id:'12',channel:'校园跑'}}});
  assert.match(wx.lastModal.content,/扣除 2 积分/);
  token='session-b';username='other';
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls.filter(x=>x[0]==='post').length,0);
  assert.match(wx.lastToast.title,/账号已切换/);
});

test('task hall ignores a slow response from the previous page',async()=>{
  let resolvePageOne;
  const api=apiStub({get:async path=>{
    if(path.startsWith('/api/tasks?'))return path.includes('page=1')?new Promise(resolve=>{resolvePageOne=resolve}):{tasks:[{id:2,text:'第二页'}],total:20,pages:2};
    if(path==='/api/settings')return {claimCost:1};
    if(path==='/api/me')return {claimCost:1,points:5};
  }});
  const {page}=harness('pages/tasks/tasks.js',api);
  const first=page.load();
  page.setData({page:2});
  const second=page.load();
  await second;
  assert.equal(page.data.tasks[0].id,2);
  resolvePageOne({tasks:[{id:1,text:'第一页旧结果'}],total:20,pages:2});
  await first;
  assert.equal(page.data.page,2);
  assert.equal(page.data.tasks[0].id,2);
});

test('task hall clears the previous account claim fee until new rules load',async()=>{
  const api=apiStub({get:path=>path.startsWith('/api/tasks?')?{tasks:[],total:0,pages:1}:path==='/api/settings'?{claimCost:0}:{claimCost:2,points:1}});
  const {page}=harness('pages/tasks/tasks.js',api,{}, {getStorageSync:key=>key==='token'?'new-account':''});
  page.sessionToken='old-account';
  page.setData({claimCost:0,feeReady:true});
  const loading=page.load();
  assert.equal(page.data.claimCost,null);
  assert.equal(page.data.feeReady,false);
  await loading;
  assert.equal(page.data.claimCost,2);
  assert.equal(page.data.feeReady,true);
});

test('channel claim stops when live fee or balance data is invalid',async()=>{
  for(const me of [{points:5},{claimCost:2,points:NaN},{claimCost:-1,points:5}]){
    const api=apiStub({get:async()=>me});
    const {page,wx}=harness('pages/channel/channel.js',api,{name:'校园跑'}, {showToast(options){wx.lastToast=options}});
    page.sessionToken='token';page.sessionUsername='';
    await page.claim({currentTarget:{dataset:{id:'12'}}});
    assert.equal(wx.lastModal,undefined);
    assert.equal(api.calls.some(x=>x[0]==='post'),false);
    assert.match(wx.lastToast.title,/接单规则或积分余额/);
  }
});

test('legacy channel links open the task hall and public chat posts without reading or spending points',async()=>{
  let sent=null;
  const api=apiStub({request:async()=>({data:[],header:{'X-Rev':'1'}}),post:async(path,data)=>{sent={path,data};return {}}});
  const legacy=harness('pages/channel/channel.js',api,{}).page;
  legacy.onLoad({name:'食堂配送'});
  await Promise.resolve();await Promise.resolve();
  assert.equal(legacy.data.name,'任务大厅');
  assert.equal(legacy.data.chatMode,false);
  assert.equal(legacy.data.taskTypeIndex,1);
  assert.equal(api.calls.some(x=>x[0]==='request'&&decodeURIComponent(x[1]).startsWith('/api/channels/任务大厅/')),true);

  const {page:chat}=harness('pages/channel/channel.js',api,{});
  chat.onLoad({name:'校园聊天'});
  await Promise.resolve();await Promise.resolve();
  chat.setData({showForm:true,text:'免费聊天'});
  await chat.publish();
  assert.equal(decodeURIComponent(sent.path),'/api/channels/校园聊天/messages');
  assert.equal(sent.data.text,'免费聊天');
  assert.equal(sent.data.task,false);
  assert.equal(api.calls.some(x=>x[0]==='get'&&x[1]==='/api/me'),false);
});

test('channel claim shows the live fee and offers recharge after a 402 response',async()=>{
  const api=apiStub({get:async()=>({claimCost:2,points:5}),post:async()=>{const e=new Error('余额不足');e.statusCode=402;throw e}});
  const {page,wx}=harness('pages/channel/channel.js',api,{name:'校园跑'});
  page.sessionToken='token';page.sessionUsername='';
  await page.claim({currentTarget:{dataset:{id:'12'}}});
  assert.match(wx.lastModal.content,/扣除 2 积分/);
  assert.equal(api.calls.some(x=>x[0]==='post'),false);
  await wx.lastModal.success({confirm:true});
  assert.match(wx.lastModal.content,/余额不足/);
  assert.equal(wx.lastModal.confirmText,'去充值');
  await wx.lastModal.success({confirm:true});
  assert.equal(wx.lastNavigation.url,'/pages/recharge/recharge');
});

test('channel claim confirmation cannot switch to a different account',async()=>{
  let token='session-a',username='worker';
  const api=apiStub({get:async()=>({claimCost:2,points:5}),post:async()=>({})});
  const {page,wx}=harness('pages/channel/channel.js',api,{name:'校园跑',username:'worker'},{getStorageSync:key=>key==='token'?token:username,showToast(options){wx.lastToast=options}});
  page.sessionToken=token;page.sessionUsername=username;
  await page.claim({currentTarget:{dataset:{id:'12'}}});
  assert.match(wx.lastModal.content,/接单将扣除 2 积分/);
  token='session-b';username='other';
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls.filter(x=>x[0]==='post').length,0);
  assert.match(wx.lastToast.title,/账号已切换/);
});

test('channel publish stays on the original account and preserves a newer account draft',async()=>{
  let token='session-a',username='poster',resolvePost;
  const api=apiStub({post:()=>new Promise(resolve=>{resolvePost=resolve})});
  const {page,wx}=harness('pages/channel/channel.js',api,{name:'校园跑',username:'poster',showForm:true,text:'A 的任务'},{getStorageSync:key=>key==='token'?token:username,showToast(options){wx.lastToast=options}});
  page.sessionToken=token;page.sessionUsername=username;
  const pending=page.publish();
  assert.equal(api.calls[0][3].header.Authorization,'Bearer session-a');
  token='session-b';username='student';
  page.onShow();
  page.setData({showForm:true,text:'B 的新草稿'});
  resolvePost({});
  await pending;
  assert.equal(page.data.username,'student');
  assert.equal(page.data.text,'B 的新草稿');
  assert.equal(page.data.posting,false);
  assert.match(wx.lastToast.title,/账号已切换/);
});

test('task detail can show a public open order without requesting private chat',async()=>{
  const api=apiStub({get:async path=>{
    if(path==='/api/tasks/77'){const e=new Error('not a party');e.statusCode=403;throw e}
    if(path.includes('/api/channels/'))return [{id:77,channel:'校园跑',user:'poster',status:'open',text:'代跑'}];
    throw new Error('open task must not request private chat');
  }});
  const {page}=harness('pages/trade/trade.js',api,{id:'77',channel:'校园跑',username:'visitor',messages:[]});
  await page.load();
  assert.equal(page.data.task.id,77);
  assert.equal(page.data.canClaim,true);
  assert.equal(page.data.canWrite,false);
  assert.deepEqual(api.calls.map(x=>x[1]),['/api/tasks/77','/api/channels/%E6%A0%A1%E5%9B%AD%E8%B7%91/messages?before=78']);
});

test('malformed channel deep link shows a recovery message without crashing or polling',async()=>{
  const api=apiStub({request:async()=>{throw new Error('invalid route must not make a request')}});
  const {page}=harness('pages/channel/channel.js',api);
  assert.doesNotThrow(()=>page.onLoad({name:'%'}));
  page.onShow();
  await page.load();
  assert.equal(page.data.name,'');
  assert.match(page.data.error,/频道链接无效/);
  assert.equal(page.timer,undefined);
  assert.equal(api.calls.length,0);
});

test('malformed trade channel deep link returns a controlled order error',async()=>{
  const api=apiStub({get:async path=>{
    if(path==='/api/tasks/77'){const e=new Error('not a participant');e.statusCode=403;throw e}
    throw new Error('malformed channel must not request a public feed');
  }});
  const {page}=harness('pages/trade/trade.js',api);
  assert.doesNotThrow(()=>page.onLoad({id:'77',channel:'%'}));
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page.data.channel,'');
  assert.match(page.data.error,/频道|订单链接/);
  assert.deepEqual(api.calls.map(x=>x[1]),['/api/tasks/77']);
});

test('former claimer orders belong to history and do not offer private chat',async()=>{
  const api=apiStub({get:async path=>{
    if(path==='/api/my/tasks?includeHistory=1')return {posted:[],claimed:[{id:81,channel:'校园跑',task:true,user:'poster',claimedBy:'student',text:'代跑',status:'former',formerClaim:true,formerStatus:'released'}]};
    throw new Error('former claim must not fetch an order chat');
  }});
  const {page}=harness('pages/orders/orders.js',api,{}, {getStorageSync:key=>key==='token'?'token':'student'});
  await page.load();
  assert.equal(page.data.active.length,0);
  assert.equal(page.data.history.length,1);
  assert.equal(page.data.history[0].statusText,'已结束（历史接单）');
  assert.match(page.data.history[0].roleText,/订单已重新分配/);
  assert.equal(api.calls.filter(x=>x[0]==='get').length,1);
});

test('orders ignore previous-account responses and clear private rows after logout',async()=>{
  let token='old-token',resolveOld,requestCount=0;
  const oldOrder={id:'old',channel:'校园跑',task:true,user:'alice',status:'open',text:'旧账号订单'};
  const newOrder={id:'new',channel:'校园跑',task:true,user:'bob',status:'open',text:'新账号订单'};
  const api=apiStub({requireLogin:()=>!!token,get:async()=>{
    requestCount++;
    return requestCount===1?new Promise(resolve=>{resolveOld=resolve}):{posted:[newOrder],claimed:[]};
  }});
  const {page}=harness('pages/orders/orders.js',api,{}, {getStorageSync:key=>key==='token'?token:key==='username'?(token==='old-token'?'alice':'bob'):''});
  const oldLoad=page.load();
  token='new-token';
  await page.load();
  assert.equal(page.data.active[0].text,'新账号订单');
  resolveOld({posted:[oldOrder],claimed:[]});
  await oldLoad;
  assert.equal(page.data.active[0].text,'新账号订单');
  token='';
  await page.load();
  assert.equal(page.data.all.length,0);
  assert.equal(page.data.visible.length,0);
});

test('personal center clears and ignores points from a previous session',async()=>{
  let token='old-token',resolveMe,resolvePoints;
  const api=apiStub({get:path=>new Promise(resolve=>{
    if(path==='/api/me')resolveMe=resolve;
    else if(path==='/api/my/points')resolvePoints=resolve;
  })});
  const {page}=harness('pages/me/me.js',api,{}, {getStorageSync:key=>key==='token'?token:key==='username'?'alice':''});
  page.setData({logged:true,username:'alice',points:42,ledger:[{id:'old',delta:42}]});
  const pending=page.load(token);
  token='';
  page.onShow();
  resolveMe({username:'alice'});
  resolvePoints({points:99,log:[{id:'old',delta:99}]});
  await pending;
  assert.equal(page.data.logged,false);
  assert.equal(page.data.username,'');
  assert.equal(page.data.points,0);
  assert.equal(page.data.ledger.length,0);
  const wxml=fs.readFileSync(path.join(root,'pages/me/me.wxml'),'utf8');
  assert.match(wxml,/class="card ledger" wx:if="\{\{logged\}\}"/);
});

test('order restore confirmation cannot switch to another account',async()=>{
  let token='session-a',username='alice';
  const api=apiStub({post:async()=>{throw new Error('stale restore must not be sent')}});
  const toasts=[];
  const {page,wx}=harness('pages/orders/orders.js',api,{},{
    getStorageSync:key=>key==='token'?token:key==='username'?username:'',
    showToast(options){toasts.push(options)}
  });
  page.sessionToken=token;page.sessionUsername=username;
  page.restore({currentTarget:{dataset:{id:'55',channel:'代取快递'}}});
  token='session-b';username='bob';
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls.some(x=>x[0]==='post'),false);
  assert.match(toasts[0].title,/账号已切换/);
});

test('order restore sends only with the account that confirmed it',async()=>{
  const api=apiStub({post:async()=>({}),get:async()=>({posted:[],claimed:[]})});
  const {page,wx}=harness('pages/orders/orders.js',api,{},{
    getStorageSync:key=>key==='token'?'session-a':key==='username'?'alice':''
  });
  page.sessionToken='session-a';page.sessionUsername='alice';
  page.restore({currentTarget:{dataset:{id:'55',channel:'代取快递'}}});
  await wx.lastModal.success({confirm:true});
  const restore=api.calls.find(x=>x[0]==='post');
  assert.equal(restore[3].header.Authorization,'Bearer session-a');
});

test('expired restore session clears private order history',async()=>{
  let token='session-a',username='alice';
  const unauthorized=Object.assign(new Error('expired'),{statusCode:401});
  const api=apiStub({
    post:async()=>{throw unauthorized},
    handleAuthError(){token='';username='';return true}
  });
  const {page,wx}=harness('pages/orders/orders.js',api,{},{
    getStorageSync:key=>key==='token'?token:key==='username'?username:'',
    removeStorageSync:key=>{if(key==='token')token='';if(key==='username')username=''}
  });
  page.sessionToken=token;page.sessionUsername=username;
  page.setData({all:[{id:'55'}],active:[{id:'55'}],history:[],visible:[{id:'55'}]});
  page.restore({currentTarget:{dataset:{id:'55',channel:'代取快递'}}});
  await wx.lastModal.success({confirm:true});
  assert.equal(page.data.all.length,0);
  assert.equal(page.data.visible.length,0);
  assert.equal(page.sessionToken,'');
});

test('personal feedback and logout dialogs are cancelled when the account changes',async()=>{
  let token='session-a',username='alice';
  const api=apiStub({get:async path=>path==='/api/me'?{username:'alice'}:{points:0,log:[]}});
  const {page,wx}=harness('pages/me/me.js',api,{},{
    getStorageSync:key=>key==='token'?token:key==='username'?username:'',
    showModal(options){wx.lastModal=options}
  });
  page.onShow();
  page.feedback();
  token='session-b';username='bob';
  await wx.lastModal.success({confirm:true,content:'Alice private feedback'});
  assert.equal(api.calls.some(x=>x[0]==='post'),false);

  page.logout();
  token='session-c';username='carol';
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls.some(x=>x[0]==='post'&&x[1]==='/api/logout'),false);
  assert.equal(wx.clearSessionCalls||0,0);
});

test('personal feedback and logout requests use the account that confirmed them',async()=>{
  const api=apiStub({post:async()=>({}),get:async path=>path==='/api/me'?{username:'alice'}:{points:0,log:[]}});
  const {page,wx}=harness('pages/me/me.js',api,{},{
    getStorageSync:key=>key==='token'?'session-a':key==='username'?'alice':''
  });
  page.onShow();
  page.feedback();
  await wx.lastModal.success({confirm:true,content:'Feedback'});
  let call=api.calls.find(x=>x[0]==='post'&&x[1]==='/api/feedback');
  assert.equal(call[3].header.Authorization,'Bearer session-a');

  page.logout();
  await wx.lastModal.success({confirm:true});
  call=api.calls.find(x=>x[0]==='post'&&x[1]==='/api/logout');
  assert.equal(call[3].header.Authorization,'Bearer session-a');
  assert.equal(wx.clearSessionCalls,1);
});

test('paid state exposes receipt confirmation only to the claimer',async()=>{
  const makeApi=()=>apiStub({get:async path=>path==='/api/tasks/9'?{id:9,channel:'代取快递',user:'poster',claimedBy:'worker',status:'paid',text:'取件'}:{task:{canWrite:true},messages:[]}});
  const {page:worker}=harness('pages/trade/trade.js',makeApi(),{id:'9',channel:'代取快递',messages:[]},{getStorageSync:key=>key==='token'?'token':'worker'});
  await worker.load();
  assert.equal(worker.data.canReceive,true);
  assert.equal(worker.data.canPay,false);
  const {page:poster}=harness('pages/trade/trade.js',makeApi(),{id:'9',channel:'代取快递',messages:[]},{getStorageSync:key=>key==='token'?'token':'poster'});
  await poster.load();
  assert.equal(poster.data.canReceive,false);
  assert.equal(poster.data.canPay,false);
});

test('claimer receipt action is sent only after the confirmation prompt',async()=>{
  const api=apiStub({post:async()=>({})});
  const {page,wx}=harness('pages/trade/trade.js',api,{id:'9',channel:'代取快递',username:'worker',messages:[]},{getStorageSync:key=>key==='token'?'token':'worker'});
  page.sessionToken='token';page.sessionUsername='worker';
  page.act({currentTarget:{dataset:{action:'received'}}});
  assert.equal(api.calls.length,0);
  assert.match(wx.lastModal.content,/实际到账/);
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls[0][1],'/api/channels/%E4%BB%A3%E5%8F%96%E5%BF%AB%E9%80%92/messages/9/received');
});

test('trade confirmation cannot run under a different account after the dialog opens',async()=>{
  let token='session-a',username='worker';
  const api=apiStub({post:async()=>({})});
  const {page,wx}=harness('pages/trade/trade.js',api,{id:'9',channel:'代取快递',username:'worker',messages:[]},{getStorageSync:key=>key==='token'?token:username,showToast(options){wx.lastToast=options}});
  page.sessionToken=token;page.sessionUsername=username;
  page.act({currentTarget:{dataset:{action:'received'}}});
  assert.match(wx.lastModal.content,/实际到账/);
  token='session-b';username='poster';
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls.filter(x=>x[0]==='post').length,0);
  assert.match(wx.lastToast.title,/账号已切换/);
});

test('trade claim confirmation is bound to the account whose balance was checked',async()=>{
  let token='session-a',username='worker';
  const api=apiStub({get:async()=>({claimCost:1,points:10}),post:async()=>({})});
  const {page,wx}=harness('pages/trade/trade.js',api,{id:'9',channel:'代取快递',username:'worker',messages:[]},{getStorageSync:key=>key==='token'?token:username,showToast(options){wx.lastToast=options}});
  page.sessionToken=token;page.sessionUsername=username;
  page.claim();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(wx.lastModal.content,/接单将扣除 1 积分/);
  token='session-b';username='other';
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls.filter(x=>x[0]==='post').length,0);
  assert.match(wx.lastToast.title,/账号已切换/);
});

test('private image selection cannot upload after the account changes',async()=>{
  let token='session-a',username='worker',picker,reader;
  const api=apiStub({request:async()=>({})});
  const {page,wx}=harness('pages/trade/trade.js',api,{id:'9',channel:'代取快递',username:'worker',canWrite:true,messages:[]},{
    getStorageSync:key=>key==='token'?token:username,
    showToast(options){wx.lastToast=options},
    chooseMedia(options){picker=options},
    getFileSystemManager(){return {readFile(options){reader=options}}}
  });
  page.sessionToken=token;page.sessionUsername=username;
  page.chooseImage();
  picker.success({tempFiles:[{tempFilePath:'/tmp/picture.png',size:4}]});
  token='session-b';username='other';
  await reader.success({data:new Uint8Array([137,80,78,71]).buffer});
  assert.equal(api.calls.filter(x=>x[0]==='request').length,0);
  assert.match(wx.lastToast.title,/账号已切换/);
});

test('expired private chat session clears messages immediately',async()=>{
  let token='session-a',username='worker';
  const unauthorized=Object.assign(new Error('expired'),{statusCode:401});
  const api=apiStub({
    post:async()=>{throw unauthorized},
    handleAuthError(){token='';username='';return true}
  });
  const {page}=harness('pages/trade/trade.js',api,{id:'9',channel:'代取快递',username:'worker',draft:'私聊内容',messages:[{id:'m1',text:'仅参与者可见'}],canWrite:true},{
    getStorageSync:key=>key==='token'?token:username,
    removeStorageSync:key=>{if(key==='token')token='';if(key==='username')username=''}
  });
  page.sessionToken=token;page.sessionUsername=username;
  await page.send();
  assert.equal(page.data.messages.length,0);
  assert.equal(page.data.task,null);
  assert.equal(page.data.draft,'');
  assert.equal(page.data.username,'');
  assert.equal(page.sessionToken,'');
});

test('banned-account appeal uses its temporary credential and loads the admin reply',async()=>{
  const api=apiStub({
    post:async(path,data,options)=>{
      if(path==='/api/login'){const e=new Error('账号已封禁');e.statusCode=403;e.body={appealToken:'appeal-only',reason:'review needed'};throw e;}
      return {};
    },
    request:async(path,options)=>({data:[{id:'1',text:'问题',replies:[{id:'2',text:'管理员已回复'}]}]})
  });
  const {page}=harness('pages/login/login.js',api);
  page.setData({agreed:true,username:'student',password:'secret12'});
  await page.submit();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(page.data.appealToken,'appeal-only');
  assert.equal(page.data.supportMessages[0].replies[0].text,'管理员已回复');
  page.setData({supportText:'请协助核查'});
  await page.submitAppeal();
  const appeal=api.calls.find(x=>x[0]==='post'&&x[1]==='/api/support');
  assert.equal(appeal[3].header.Authorization,'Bearer appeal-only');
});

test('home keeps channels and announcements visible when task loading fails',async()=>{
  const api=apiStub({get:async path=>{
    if(path==='/api/channels')return [{name:'校园跑',count:2}];
    if(path==='/api/announcements')return [{id:'1',title:'公告',text:'通知'}];
    if(path==='/api/tasks?limit=6')throw new Error('network unavailable');
    throw new Error('unexpected GET '+path);
  }});
  const {page}=harness('pages/index/index.js',api);
  await page.load();
  assert.equal(page.data.channels.length,1);
  assert.equal(page.data.announcements.length,1);
  assert.equal(page.data.tasks.length,0);
  assert.match(page.data.loadError,/任务/);
});

test('recharge requests stay bound to the active account and discard older records',async()=>{
  let token='session-a',username='alice',resolveOld;
  const api=apiStub({request:(path,options)=>{
    assert.equal(path,'/api/my/recharges');
    if(token==='session-a'){
      assert.equal(options.header.Authorization,'Bearer session-a');
      return new Promise(resolve=>{resolveOld=resolve});
    }
    assert.equal(options.header.Authorization,'Bearer session-b');
    return Promise.resolve({data:[{id:'new',status:'approved',time:1,amount:5} ]});
  }});
  const {page}=harness('pages/recharge/recharge.js',api,{}, {
    getStorageSync:key=>key==='token'?token:key==='username'?username:''
  });
  page.onLoad();
  const oldLoad=page.load();
  token='session-b';username='bob';
  assert.equal(page.syncSession().changed,true);
  const newLoad=page.load();
  await newLoad;
  resolveOld({data:[{id:'old',status:'pending',time:1,amount:99}]});
  await oldLoad;
  assert.deepEqual(page.data.records.map(x=>x.id),['new']);
  assert.equal(page.data.username,'bob');
});

test('recharge submission preserves the original account and clears its draft on account change',async()=>{
  let token='session-a',username='alice';
  const api=apiStub({});
  const toasts=[];
  const {page}=harness('pages/recharge/recharge.js',api,{}, {
    getStorageSync:key=>key==='token'?token:key==='username'?username:'',
    showToast(options){toasts.push(options)}
  });
  page.onLoad();
  page.setData({amount:'12',note:'Alice payment'});
  await page.submit();
  let submission=api.calls.find(x=>x[0]==='post');
  assert.equal(submission[1],'/api/recharge');
  assert.equal(submission[3].header.Authorization,'Bearer session-a');

  page.setData({amount:'20',note:'private note'});
  token='session-b';username='bob';
  const before=api.calls.filter(x=>x[0]==='post').length;
  await page.submit();
  assert.equal(api.calls.filter(x=>x[0]==='post').length,before);
  assert.equal(page.data.amount,'');
  assert.equal(page.data.note,'');
  assert.match(toasts.at(-1).title,/账号已切换/);
});

test('leaderboard ignores private reward data from an earlier account',async()=>{
  let token='session-a',username='alice',resolveOld;
  const api=apiStub({request:(path,options)=>{
    assert.equal(path,'/api/leaderboard');
    if(token==='session-a'){
      assert.equal(options.header.Authorization,'Bearer session-a');
      return new Promise(resolve=>{resolveOld=resolve});
    }
    assert.equal(options.header.Authorization,'Bearer session-b');
    return Promise.resolve({data:{live:{key:'live'},locked:null,myRewards:[{key:'bob-reward'}]}});
  }});
  const {page}=harness('pages/leaderboard/leaderboard.js',api,{},{
    getStorageSync:key=>key==='token'?token:key==='username'?username:''
  });
  page.onLoad();
  const oldLoad=page.load();
  token='session-b';username='bob';
  page.syncSession();
  const newLoad=page.load();
  await newLoad;
  resolveOld({data:{live:{key:'old-live'},locked:null,myRewards:[{key:'alice-reward'}]}});
  await oldLoad;
  assert.deepEqual(page.data.myRewards.map(x=>x.key),['bob-reward']);
  assert.equal(page.data.live.key,'live');
});

test('weekly reward QR upload stops before sending after an account switch',async()=>{
  let token='session-a',username='alice',picker,reader;
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
  const api=apiStub({request:async()=>({})});
  const {page}=harness('pages/leaderboard/leaderboard.js',api,{},{
    getStorageSync:key=>key==='token'?token:key==='username'?username:'',
    chooseMedia(options){picker=options},
    getFileSystemManager(){return {readFile(options){reader=options}}}
  });
  page.onLoad();
  const pending=page.uploadQr({currentTarget:{dataset:{period:'2026-11-02'}}});
  picker.success({tempFiles:[{tempFilePath:'selected-image',size:bytes.length}]});
  await Promise.resolve();
  assert.ok(reader);
  token='session-b';username='bob';
  page.syncSession();
  reader.success({data:bytes.buffer});
  await pending;
  assert.equal(api.calls.some(x=>x[0]==='request'&&x[1].includes('/weekly-reward/qr')),false);
  assert.equal(page.data.uploading,false);
});

test('weekly reward QR picker prevents duplicate taps and reports selection failures',async()=>{
  let picker,chooseCalls=0;
  const toasts=[];
  const api=apiStub({request:async()=>({})});
  const {page}=harness('pages/leaderboard/leaderboard.js',api,{}, {
    chooseMedia(options){chooseCalls++;picker=options},
    showToast(options){toasts.push(options)}
  });
  page.onLoad();
  const event={currentTarget:{dataset:{period:'2026-11-02'}}};
  const pending=page.uploadQr(event);
  assert.equal(page.data.uploading,true);
  assert.equal(chooseCalls,1);
  await page.uploadQr(event);
  assert.equal(chooseCalls,1);
  picker.fail({errMsg:'chooseMedia:fail cancel'});
  await pending;
  assert.equal(page.data.uploading,false);
  assert.equal(toasts.length,0);

  const failed=page.uploadQr(event);
  picker.fail({errMsg:'chooseMedia:fail auth deny'});
  await failed;
  assert.equal(page.data.uploading,false);
  assert.equal(toasts.length,1);
  assert.match(toasts[0].title,/检查权限/);
  assert.equal(api.calls.some(x=>x[0]==='request'),false);
});

test('weekly reward QR upload rejects unsupported image formats before sending',async()=>{
  const toasts=[];
  const api=apiStub({request:async()=>{throw new Error('unsupported image must not be uploaded')}});
  const {page}=harness('pages/leaderboard/leaderboard.js',api,{}, {
    chooseMedia(options){options.success({tempFiles:[{tempFilePath:'selected-image',size:24}]})},
    getFileSystemManager(){return {readFile(options){options.success({data:new Uint8Array([1,2,3,4]).buffer})}}},
    showToast(options){toasts.push(options)}
  });
  page.onLoad();
  await page.uploadQr({currentTarget:{dataset:{period:'2026-11-02'}}});
  assert.equal(page.data.uploading,false);
  assert.equal(api.calls.some(x=>x[0]==='request'),false);
  assert.match(toasts[0].title,/PNG 或 JPEG/);
});

test('weekly reward QR upload sends PNG bytes with the correct content type',async()=>{
  const toasts=[];
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
  const api=apiStub({
    request:async(path)=>path==='/api/leaderboard'?{data:{live:null,locked:null,myRewards:[]}}:{}
  });
  const {page}=harness('pages/leaderboard/leaderboard.js',api,{}, {
    chooseMedia(options){options.success({tempFiles:[{tempFilePath:'selected-image',size:bytes.length}]})},
    getFileSystemManager(){return {readFile(options){options.success({data:bytes.buffer})}}},
    showToast(options){toasts.push(options)}
  });
  page.onLoad();
  await page.uploadQr({currentTarget:{dataset:{period:'2026-11-02'}}});
  const upload=api.calls.find(x=>x[0]==='request'&&x[1].includes('/weekly-reward/qr'));
  assert.equal(upload[1],'/api/my/weekly-reward/qr?period=2026-11-02');
  assert.equal(upload[2].header['Content-Type'],'image/png');
  assert.equal(upload[2].header.Authorization,'Bearer token');
  assert.equal(upload[2].data,bytes.buffer);
  assert.equal(page.data.uploading,false);
  assert.equal(page.data.error,'');
  assert.equal(toasts[0].title,'收款码已私密提交');
});

test('weekly reward QR upload reports local file read failures and clears busy state',async()=>{
  const toasts=[];
  const api=apiStub({request:async()=>({})});
  const {page}=harness('pages/leaderboard/leaderboard.js',api,{}, {
    chooseMedia(options){options.success({tempFiles:[{tempFilePath:'selected-image',size:24}]})},
    getFileSystemManager(){return {readFile(options){options.fail(new Error('disk unavailable'))}}},
    showToast(options){toasts.push(options)}
  });
  page.onLoad();
  await page.uploadQr({currentTarget:{dataset:{period:'2026-11-02'}}});
  assert.equal(page.data.uploading,false);
  assert.equal(api.calls.some(x=>x[0]==='request'),false);
  assert.match(toasts[0].title,/读取收款码失败/);
});

test('private chat image failures show a retry control and non-200 downloads can recover',async()=>{
  const downloads=[];
  const api=apiStub({get:async path=>{
    if(path==='/api/tasks/77')return {id:77,channel:'代取快递',user:'poster',claimedBy:'student',status:'claimed',text:'取件'};
    if(path==='/api/tasks/77/chat')return {task:{canWrite:true},messages:[{id:'img-1',user:'poster',image:'/api/tasks/77/chat/images/img-1',text:'商品照片'}]};
    throw new Error('unexpected GET '+path);
  }});
  const {page}=harness('pages/trade/trade.js',api,{id:'77',channel:'代取快递',messages:[]},{
    getStorageSync:key=>key==='token'?'session-a':'student',
    downloadFile(options){downloads.push(options)}
  });
  page.loadedImages=new Set();
  page.sessionToken='session-a';
  await page.load();
  assert.equal(downloads.length,1);
  assert.equal(page.data.messages[0].imageStatus,'loading');
  downloads[0].success({statusCode:503});
  assert.equal(page.data.messages[0].imageStatus,'failed');
  page.retryImage({currentTarget:{dataset:{id:'img-1'}}});
  assert.equal(downloads.length,2);
  downloads[1].success({statusCode:200,tempFilePath:'/tmp/private-chat-image.jpg'});
  assert.equal(page.data.messages[0].localImage,'/tmp/private-chat-image.jpg');
  assert.equal(page.data.messages[0].imageStatus,'loaded');
});

test('account change clears private chat and ignores an old image response',async()=>{
  let token='session-a',username='poster';
  const downloads=[];
  const task={id:77,channel:'代取快递',user:'poster',claimedBy:'student',status:'claimed',text:'取件'};
  const forbidden=()=>{const e=new Error('not a participant');e.statusCode=403;throw e};
  const api=apiStub({get:async path=>{
    if(path==='/api/tasks/77')return token==='session-a'?task:forbidden();
    if(path.startsWith('/api/channels/'))return [task];
    if(path==='/api/tasks/77/chat')return token==='session-a'?{task:{canWrite:true},messages:[{id:'img-1',user:'poster',image:'/api/tasks/77/chat/images/img-1',text:'仅参与者可见'}]}:forbidden();
    throw new Error('unexpected GET '+path);
  }});
  const {page}=harness('pages/trade/trade.js',api,{id:'77',channel:'代取快递',messages:[]},{
    getStorageSync:key=>key==='token'?token:username,
    downloadFile(options){downloads.push(options)}
  });
  page.loadedImages=new Set();
  page.sessionToken='session-a';
  await page.load();
  assert.equal(page.data.messages[0].text,'仅参与者可见');

  token='session-b';username='visitor';
  await page.load();
  assert.equal(page.data.messages.length,0);
  downloads[0].success({statusCode:200,tempFilePath:'/tmp/old-account-image.jpg'});
  assert.equal(page.data.messages.length,0);
  assert.equal(page.data.task,null);
});

test('account change clears chat while a private task request is still pending',async()=>{
  let token='session-a',username='poster',calls=0,resolveOldTask;
  const task={id:77,channel:'代取快递',user:'poster',claimedBy:'student',status:'claimed',text:'旧账号订单'};
  const forbidden=()=>{const e=new Error('not a participant');e.statusCode=403;throw e};
  const api=apiStub({get:async path=>{
    if(path==='/api/tasks/77'){
      calls++;
      if(calls===1)return new Promise(resolve=>{resolveOldTask=resolve});
      return forbidden();
    }
    if(path.startsWith('/api/channels/'))return [task];
    if(path==='/api/tasks/77/chat')return forbidden();
    throw new Error('unexpected GET '+path);
  }});
  const {page}=harness('pages/trade/trade.js',api,{id:'77',channel:'代取快递',messages:[{id:'old',text:'旧私聊'}]},{
    getStorageSync:key=>key==='token'?token:username
  });
  page.sessionToken='session-a';
  const pending=page.load(true);
  assert.equal(page.loading,true);

  token='session-b';username='visitor';
  await page.load(true);
  assert.equal(page.data.messages.length,0);
  assert.equal(page.data.task,null);
  resolveOldTask(task);
  await pending;
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);
  assert.equal(page.data.messages.length,0);
  assert.equal(page.data.task,null);
  assert.equal(page.loading,false);
});

test('pre-claim consultation creates an independent free thread and renders the publisher reply',async()=>{
  const paths=[],posts=[];
  const api=apiStub({
    get:async path=>{
      paths.push(path);
      if(path==='/api/tasks/77/inquiries')return {task:{id:77,channel:'任务大厅',user:'poster',status:'open',claimedBy:null,text:'帮取快递',reward:'5元',place:'东门',canWrite:true},messages:[]};
      if(path==='/api/tasks/77/inquiries?inquiryId=thread-bob')return {task:{id:77,channel:'任务大厅',user:'poster',status:'open',claimedBy:null,text:'帮取快递',canWrite:true},inquiryId:'thread-bob',user:'student',messages:[{id:1,user:'student',text:'东门哪里？'},{id:2,user:'poster',text:'东门快递柜'}]};
      throw new Error('unexpected GET '+path);
    },
    post:async(path,data)=>{posts.push({path,data});return {id:1,inquiryId:'thread-bob',text:data.text}}
  });
  const {page}=harness('pages/trade/trade.js',api,{id:'77',channel:'任务大厅',inquiryMode:true,messages:[]},{getStorageSync:key=>key==='token'?'session':'student'});
  page.sessionToken='session';page.sessionUsername='student';
  await page.load();
  assert.equal(page.data.canWrite,true);assert.equal(page.data.canClaim,false);
  page.setData({draft:'东门哪里？'});
  await page.send();
  assert.equal(posts.length,1);assert.equal(posts[0].path,'/api/tasks/77/inquiries');assert.equal(posts[0].data.text,'东门哪里？');
  assert.ok(paths.includes('/api/tasks/77/inquiries?inquiryId=thread-bob'));
  assert.equal(page.data.inquiryId,'thread-bob');
  assert.equal(JSON.stringify(page.data.messages.map(x=>x.text)),JSON.stringify(['东门哪里？','东门快递柜']));
});

test('publisher inbox selects isolated inquiry threads and enables replies',async()=>{
  const api=apiStub({get:async path=>{
    assert.equal(path,'/api/tasks/88/inquiries');
    return {task:{id:88,channel:'任务大厅',user:'publisher',status:'open',claimedBy:null,text:'买咖啡',inquiryUnread:1},threads:[{inquiryId:'buyer-one',user:'buyer',count:2,unread:1,last:{text:'能帮买吗？'},canWrite:true}]};
  }});
  const {page,wx}=harness('pages/trade/trade.js',api,{id:'88',channel:'任务大厅',inquiryMode:true,messages:[]},{getStorageSync:key=>key==='token'?'session':'publisher'});
  page.sessionToken='session';page.sessionUsername='publisher';
  await page.load();
  assert.equal(page.data.showThreads,true);assert.equal(page.data.threads[0].preview,'能帮买吗？');assert.equal(page.data.canWrite,false);
  page.selectThread({currentTarget:{dataset:{id:'buyer-one'}}});
  assert.match(wx.lastNavigation.url,/inquiryId=buyer-one/);
});

test('task hall and personal orders keep consultation actions bound to each account',async()=>{
  const task={id:78,channel:'任务大厅',user:'publisher',status:'open',text:'买咖啡',inquiryCount:1,inquiryUnread:1};
  const taskApi=apiStub({get:async path=>{
    if(path==='/api/tasks?status=open&limit=10&page=1')return {tasks:[task],total:1,pages:1};
    if(path==='/api/settings')return {claimCost:1};
    if(path==='/api/me')return {claimCost:1,points:5};
    throw new Error('unexpected GET '+path);
  }});
  const {page:buyer,wx:buyerWx}=harness('pages/tasks/tasks.js',taskApi,{}, {getStorageSync:key=>key==='token'?'buyer-token':'buyer'});
  await buyer.load();
  assert.equal(buyer.data.username,'buyer');
  buyer.consult({currentTarget:{dataset:{id:78,channel:'任务大厅'}}});
  assert.match(buyerWx.lastNavigation.url,/inquiry=1/);

  const publisherOrders=apiStub({get:async path=>{
    assert.equal(path,'/api/my/tasks?includeHistory=1');
    return {posted:[task],claimed:[]};
  }});
  const {page:orders,wx:ordersWx}=harness('pages/orders/orders.js',publisherOrders,{}, {getStorageSync:key=>key==='token'?'publisher-token':'publisher'});
  await orders.load();
  assert.equal(orders.data.username,'publisher');
  orders.openInquiries({currentTarget:{dataset:{id:78,channel:'任务大厅'}}});
  assert.match(ordersWx.lastNavigation.url,/inquiry=1/);
});

test('publisher receives the free completion button while an order is claimed',async()=>{
  const api=apiStub({get:async path=>{
    if(path==='/api/tasks/99')return {id:99,channel:'任务大厅',user:'publisher',claimedBy:'worker',status:'claimed',text:'纯积分任务',bonusPoints:10};
    if(path==='/api/tasks/99/chat')return {task:{canWrite:true},messages:[]};
    throw new Error('unexpected GET '+path);
  }});
  const {page}=harness('pages/trade/trade.js',api,{id:'99',channel:'任务大厅',messages:[]},{getStorageSync:key=>key==='token'?'session':'publisher'});
  page.sessionToken='session';page.sessionUsername='publisher';
  await page.load();
  assert.equal(page.data.canComplete,true);assert.equal(page.data.canPay,false);
  const wxml=fs.readFileSync(path.join(root,'pages/trade/trade.wxml'),'utf8');
  assert.match(wxml,/wx:if="\{\{canComplete\}\}"/);
});
