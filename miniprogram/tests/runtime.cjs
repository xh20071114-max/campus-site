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
    downloadFile(){},chooseImage(){},getFileSystemManager(){return {readFile(){}}}
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

test('login requires explicit agreement before sending credentials',async()=>{
  const api=apiStub({post:async()=>{throw new Error('must not call')}});
  const {page}=harness('pages/login/login.js',api);
  page.setData({username:'student',password:'secret12'});
  await page.submit();
  assert.match(page.data.error,/同意/);
  assert.equal(api.calls.length,0);
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
