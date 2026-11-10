const api=require('../../utils/api');
const fmt=require('../../utils/format');
const TASK_CHANNEL='任务大厅',CHAT_CHANNEL='校园聊天';
const OLD_TASK_CHANNELS=new Set(['校园跑','校园配送','食堂配送','代取快递','代课','代做作业']);

function decodeRouteValue(value){try{return decodeURIComponent(value)}catch{return null}}

Page({
  data:{name:'',messages:[],username:'',showForm:false,chatMode:false,text:'',reward:'',place:'',date:'',time:'',postCost:0,posting:false,error:''},
  onLoad(q){
    this.sessionToken=wx.getStorageSync('token')||'';this.sessionUsername=wx.getStorageSync('username')||'';
    let name=q.name?decodeRouteValue(q.name):TASK_CHANNEL;
    if(name===null){this.invalidRoute=true;this.setData({name:'',username:wx.getStorageSync('username')||'',error:'频道链接无效，请从首页重新打开'});return}
    if(OLD_TASK_CHANNELS.has(name))name=TASK_CHANNEL;
    this.setData({name,chatMode:name===CHAT_CHANNEL,username:wx.getStorageSync('username')||''});
    this.load();
  },
  onShow(){
    this.syncSession();
    if(this.invalidRoute)return;
    if(!this.timer)this.timer=setInterval(()=>this.load(true),8000);
  },
  onHide(){if(this.timer){clearInterval(this.timer);this.timer=null}},
  onUnload(){if(this.timer)clearInterval(this.timer)},
  syncSession(){
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';
    if(token!==this.sessionToken||username!==this.sessionUsername){
      this.sessionToken=token;this.sessionUsername=username;this.publishRequestId=(this.publishRequestId||0)+1;
      this.setData({username,showForm:false,text:'',reward:'',place:'',date:'',time:'',postCost:0,posting:false});
    }else if(this.data.username!==username)this.setData({username});
    return {token,username};
  },
  sameSession(token,username){return !!token&&token===(wx.getStorageSync('token')||'')&&username===(wx.getStorageSync('username')||'')&&token===this.sessionToken&&username===this.sessionUsername&&username===this.data.username},
  staleAction(){this.syncSession();wx.showToast({title:'账号已切换，原操作已取消',icon:'none'})},
  async load(silent){
    if(this.invalidRoute||!this.data.name)return;
    if(this.loading)return;this.loading=true;
    try{
      const first=!this.rev;
      const res=await api.request('/api/channels/'+encodeURIComponent(this.data.name)+'/messages?rev='+(first?'0':this.rev));
      const rows=res.data||[],byId=new Map((first?[]:this.data.messages).map(x=>[String(x.id),x]));
      rows.forEach(x=>byId.set(String(x.id),x));
      const merged=Array.from(byId.values()).sort((a,b)=>a.id-b.id).slice(-50);
      this.setData({messages:merged.map(x=>({...x,statusText:fmt.status(x.status),timeText:fmt.date(x.time),deadlineText:fmt.date(x.deadline)})),error:''});
      const header=res.header||{},revKey=Object.keys(header).find(k=>k.toLowerCase()==='x-rev');
      if(revKey)this.rev=header[revKey];
    }catch(e){if(!silent)this.setData({error:e.message})}
    finally{this.loading=false}
  },
  async toggleForm(){
    if(!api.requireLogin())return;
    if(this.data.chatMode){this.setData({showForm:!this.data.showForm});return}
    const {token,username}=this.syncSession();
    if(!this.sameSession(token,username)){this.staleAction();return}
    try{const me=await api.get('/api/me');if(!this.sameSession(token,username)){this.staleAction();return}this.setData({postCost:me.postCost,showForm:!this.data.showForm})}
    catch(e){if(!this.sameSession(token,username)){this.staleAction();return}api.handleAuthError(e)||wx.showToast({title:e.message,icon:'none'})}
  },
  onText(e){this.setData({text:e.detail.value})},
  onReward(e){this.setData({reward:e.detail.value})},
  onPlace(e){this.setData({place:e.detail.value})},
  onDate(e){this.setData({date:e.detail.value})},
  onTime(e){this.setData({time:e.detail.value})},
  async publish(){
    if(this.data.posting)return;
    if(!api.requireLogin())return;
    const {token,username}=this.syncSession();
    if(!this.sameSession(token,username)){this.staleAction();return}
    if(!this.data.text.trim())return wx.showToast({title:'请写任务描述',icon:'none'});
    let deadline='';
    if(this.data.date&&this.data.time)deadline=new Date(this.data.date+'T'+this.data.time+':00+08:00').toISOString();
    const task=!this.data.chatMode;
    const data=task?{text:this.data.text.trim(),task:true,reward:this.data.reward,place:this.data.place,...(deadline?{deadline}:{})}:{text:this.data.text.trim(),task:false};
    const requestId=(this.publishRequestId||0)+1;this.publishRequestId=requestId;
    this.setData({posting:true});
    try{
      await api.post('/api/channels/'+encodeURIComponent(this.data.name)+'/messages',data,{header:{Authorization:'Bearer '+token}});
      if(!this.sameSession(token,username)){this.staleAction();return}
      this.setData({showForm:false,text:'',reward:'',place:'',date:'',time:''});
      wx.showToast({title:task?'任务已发布':'消息已发送'});this.load();
    }catch(e){
      if(!this.sameSession(token,username)){this.staleAction();return}
      if(e.statusCode===402)wx.showModal({title:'积分不足',content:e.message,confirmText:'去充值',success:r=>{if(r.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});
      else api.handleAuthError(e)||wx.showToast({title:e.message,icon:'none'});
    }finally{if(requestId===this.publishRequestId)this.setData({posting:false})}
  },
  async claim(e){
    if(!api.requireLogin())return;
    const {token,username}=this.syncSession();
    if(!this.sameSession(token,username)){this.staleAction();return}
    const id=e.currentTarget.dataset.id;
    try{
      const me=await api.get('/api/me');if(!this.sameSession(token,username)){this.staleAction();return}const cost=me.claimCost;
      if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0||typeof me.points!=='number'||!Number.isFinite(me.points)||me.points<0)return wx.showToast({title:'接单规则或积分余额暂不可用，请稍后重试',icon:'none'});
      if(me.points<cost)return wx.showModal({title:'积分不足',content:'接单需要 '+cost+' 积分，当前 '+me.points+' 积分。是否去充值？',confirmText:'去充值',success:r=>{if(r.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});
      wx.showModal({title:'确认接单',content:cost===0?'本次免扣积分。':'接单将扣除 '+cost+' 积分。放弃接单不会退还。',success:async r=>{
        if(!r.confirm)return;
        if(!this.sameSession(token,username)){this.staleAction();return}
        try{await api.post('/api/channels/'+encodeURIComponent(this.data.name)+'/messages/'+id+'/claim',{}, {header:{Authorization:'Bearer '+token}});if(!this.sameSession(token,username))return;wx.navigateTo({url:'/pages/trade/trade?id='+id+'&channel='+encodeURIComponent(this.data.name)})}
        catch(err){if(!this.sameSession(token,username)){this.staleAction();return}if(err.statusCode===402)wx.showModal({title:'积分不足',content:err.message||'接单积分不足，请先充值',confirmText:'去充值',success:x=>{if(x.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});else api.handleAuthError(err)||wx.showToast({title:err.message,icon:'none'})}
      }});
    }catch(err){if(!this.sameSession(token,username)){this.staleAction();return}api.handleAuthError(err)||wx.showToast({title:err.message,icon:'none'})}
  },
  refresh(){this.load(false)},
  openTrade(e){wx.navigateTo({url:'/pages/trade/trade?id='+e.currentTarget.dataset.id+'&channel='+encodeURIComponent(this.data.name)})},
  consult(e){if(!api.requireLogin())return;wx.navigateTo({url:'/pages/trade/trade?id='+e.currentTarget.dataset.id+'&channel='+encodeURIComponent(this.data.name)+'&inquiry=1'})},
  viewInquiries(e){if(!api.requireLogin())return;wx.navigateTo({url:'/pages/trade/trade?id='+e.currentTarget.dataset.id+'&channel='+encodeURIComponent(this.data.name)+'&inquiry=1'})}
});
