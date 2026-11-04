const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
const projectConfig=JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8'));
assert.equal(projectConfig.appid,'wx312deec0abd7330f','project must use the configured mini program AppID');
JSON.parse(fs.readFileSync(path.join(root,'sitemap.json'),'utf8'));
global.getApp=()=>({globalData:{apiBase:'https://plgslzlexpmy.sealoshzh.site'}});
global.wx={getStorageSync(){return ''},request(){}};
const pageObjects=new Map();

for(const page of config.pages){
  const base=path.join(root,page),js=base+'.js';
  for(const ext of ['js','wxml','wxss'])assert.ok(fs.existsSync(base+'.'+ext),'missing page asset '+page+'.'+ext);
  const scoped=base+'.json';if(fs.existsSync(scoped))JSON.parse(fs.readFileSync(scoped,'utf8'));
  const source=fs.readFileSync(js,'utf8');
  const context={Page(value){pageObjects.set(page,value)},wx:{},getApp(){return {globalData:{apiBase:'https://plgslzlexpmy.sealoshzh.site'}}},require:createRequire(js),setInterval(){},clearInterval(){},console,Map,Set,Promise,Date,Number,String,Array,Object,Math,JSON,Error,Uint8Array,ArrayBuffer};
  vm.runInNewContext(source,context,{filename:js});
  const wxml=fs.readFileSync(base+'.wxml','utf8'),object=pageObjects.get(page);
  for(const event of ['bindtap','bindinput','bindchange'])for(const method of wxml.matchAll(new RegExp(event+'="([A-Za-z_$][\\w$]*)"','g')))
    assert.equal(typeof object[method[1]],'function',page+' missing handler '+method[1]);
}

let app;
vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),{App(value){app=value},wx:{getStorageSync(){return ''}},console});
assert.match(app.globalData.apiBase,/^https:\/\//,'API must use HTTPS');
assert.equal(config.pages.length,10);
assert.ok(fs.readFileSync(path.join(root,'..','.dockerignore'),'utf8').split(/\r?\n/).includes('miniprogram'),'mini program source must stay out of the website image');
assert.ok(pageObjects.get('pages/trade/trade').act,'trade actions must be wired');
assert.ok(pageObjects.get('pages/channel/channel').publish,'task publishing must be wired');
const leaderboardWxml=fs.readFileSync(path.join(root,'pages/leaderboard/leaderboard.wxml'),'utf8');
assert.ok(leaderboardWxml.includes('disabled="{{uploading}}"')&&leaderboardWxml.includes('loading="{{uploading}}"'),'reward image upload buttons must block duplicate submissions');
const ordersWxml=fs.readFileSync(path.join(root,'pages/orders/orders.wxml'),'utf8');
assert.ok(ordersWxml.includes('!item.deleted&&!item.formerClaim'),'former claim history must not offer private chat');
assert.ok(ordersWxml.includes('本记录不再开放原订单私聊'),'former claim history must explain why chat is unavailable');

const apiFile=path.join(root,'utils/api.js');
let call;
global.getApp=()=>({globalData:{apiBase:app.globalData.apiBase}});
global.wx={getStorageSync(key){return key==='token'?'stored-session':'stored-user'},request(options){call=options;options.success({statusCode:200,data:{ok:true}})}};
const api=require(apiFile);
(async()=>{
  await api.request('/preflight',{header:{Authorization:'Bearer appeal-only'}});
  assert.equal(call.header.Authorization,'Bearer appeal-only','appeal credential must override a stale session');
  await api.request('/preflight');
  assert.equal(call.header.Authorization,'Bearer stored-session','normal requests must use the saved session');
  global.wx.request=options=>options.fail({errMsg:'request:fail url not in domain list'});
  await assert.rejects(api.request('/preflight'),/合法域名/,'request-domain failures should explain the required platform setting');
  const trade=fs.readFileSync(path.join(root,'pages/trade/trade.js'),'utf8');
  const tasks=fs.readFileSync(path.join(root,'pages/tasks/tasks.js'),'utf8');
  const channel=fs.readFileSync(path.join(root,'pages/channel/channel.js'),'utf8');
  for(const action of ['finish','paid','received','complete','acceptfree','declinefree'])assert.ok(trade.includes(action),'missing trade action '+action);
  assert.ok(tasks.includes('feeReady')&&tasks.includes('/api/settings'),'task hall must stop claims if fee rules cannot be read');
  assert.ok(channel.includes('reward:this.data.reward')&&!channel.includes('bonusPoints'),'regular task composer must omit bonus-point input');
  assert.ok(trade.includes('wx.downloadFile')&&trade.includes('Authorization'),'private chat images must use authenticated downloads');
  console.log('Mini program preflight passed: '+config.pages.length+' pages, JSON/JS syntax, WXML event wiring, HTTPS and key task/trade/auth flows.');
})().catch(e=>{console.error(e);process.exitCode=1});
