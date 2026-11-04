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
  const context={Page(value){definition=value},wx,getApp(){return {globalData:{apiBase:'https://plgslzlexpmy.sealoshzh.site'}}},require(name){return name.includes('api')?api:format},setInterval(){return 1},clearInterval(){},getCurrentPages(){return [{}]},console};
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
    requireLogin(){return true},handleAuthError(){return false}
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
  page.setData({error:'请先阅读并同意用户协议与隐私说明'});
  page.onAgreement({detail:{value:['agree']}});
  assert.equal(page.data.agreed,true);
  assert.equal(page.data.error,'');
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
  await page.claim({currentTarget:{dataset:{id:'12',channel:'校园跑'}}});
  assert.match(wx.lastModal.content,/扣除 3 积分/);
  assert.equal(api.calls.filter(x=>x[0]==='post').length,0);
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls.find(x=>x[0]==='post')[1],'/api/channels/%E6%A0%A1%E5%9B%AD%E8%B7%91/messages/12/claim');
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
  const {page,wx}=harness('pages/trade/trade.js',api,{id:'9',channel:'代取快递',messages:[]});
  page.act({currentTarget:{dataset:{action:'received'}}});
  assert.equal(api.calls.length,0);
  assert.match(wx.lastModal.content,/实际到账/);
  await wx.lastModal.success({confirm:true});
  assert.equal(api.calls[0][1],'/api/channels/%E4%BB%A3%E5%8F%96%E5%BF%AB%E9%80%92/messages/9/received');
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

test('weekly reward QR picker prevents duplicate taps and reports selection failures',async()=>{
  let picker,chooseCalls=0;
  const toasts=[];
  const api=apiStub({request:async()=>({})});
  const {page}=harness('pages/leaderboard/leaderboard.js',api,{}, {
    chooseMedia(options){chooseCalls++;picker=options},
    showToast(options){toasts.push(options)}
  });
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
  await page.uploadQr({currentTarget:{dataset:{period:'2026-11-02'}}});
  assert.equal(page.data.uploading,false);
  assert.equal(api.calls.some(x=>x[0]==='request'),false);
  assert.match(toasts[0].title,/PNG 或 JPEG/);
});

test('weekly reward QR upload sends PNG bytes with the correct content type',async()=>{
  const toasts=[];
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
  const api=apiStub({
    request:async()=>({}),
    get:async()=>({live:null,locked:null,myRewards:[]})
  });
  const {page}=harness('pages/leaderboard/leaderboard.js',api,{}, {
    chooseMedia(options){options.success({tempFiles:[{tempFilePath:'selected-image',size:bytes.length}]})},
    getFileSystemManager(){return {readFile(options){options.success({data:bytes.buffer})}}},
    showToast(options){toasts.push(options)}
  });
  await page.uploadQr({currentTarget:{dataset:{period:'2026-11-02'}}});
  const upload=api.calls.find(x=>x[0]==='request');
  assert.equal(upload[1],'/api/my/weekly-reward/qr?period=2026-11-02');
  assert.equal(upload[2].header['Content-Type'],'image/png');
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
