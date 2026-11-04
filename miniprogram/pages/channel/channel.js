const api=require('../../utils/api');
const fmt=require('../../utils/format');

function decodeRouteValue(value){try{return decodeURIComponent(value)}catch{return null}}

Page({
  data:{name:'',messages:[],username:'',showForm:false,text:'',reward:'',place:'',date:'',time:'',postCost:0,posting:false,error:''},
  onLoad(q){
    const name=q.name?decodeRouteValue(q.name):'校园跑';
    if(name===null){this.invalidRoute=true;this.setData({name:'',username:wx.getStorageSync('username')||'',error:'频道链接无效，请从首页重新打开'});return}
    this.setData({name,username:wx.getStorageSync('username')||''});
    this.load();
  },
  onShow(){
    this.setData({username:wx.getStorageSync('username')||''});
    if(this.invalidRoute)return;
    if(!this.timer)this.timer=setInterval(()=>this.load(true),8000);
  },
  onHide(){if(this.timer){clearInterval(this.timer);this.timer=null}},
  onUnload(){if(this.timer)clearInterval(this.timer)},
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
    try{const me=await api.get('/api/me');this.setData({postCost:me.postCost,showForm:!this.data.showForm})}
    catch(e){api.handleAuthError(e)||wx.showToast({title:e.message,icon:'none'})}
  },
  onText(e){this.setData({text:e.detail.value})},
  onReward(e){this.setData({reward:e.detail.value})},
  onPlace(e){this.setData({place:e.detail.value})},
  onDate(e){this.setData({date:e.detail.value})},
  onTime(e){this.setData({time:e.detail.value})},
  async publish(){
    if(this.data.posting)return;
    if(!this.data.text.trim())return wx.showToast({title:'请写任务描述',icon:'none'});
    if(!api.requireLogin())return;
    let deadline='';
    if(this.data.date&&this.data.time)deadline=new Date(this.data.date+'T'+this.data.time+':00+08:00').toISOString();
    const data={text:this.data.text.trim(),task:true,reward:this.data.reward,place:this.data.place,...(deadline?{deadline}:{})};
    this.setData({posting:true});
    try{
      await api.post('/api/channels/'+encodeURIComponent(this.data.name)+'/messages',data);
      this.setData({showForm:false,text:'',reward:'',place:'',date:'',time:''});
      wx.showToast({title:'任务已发布'});this.load();
    }catch(e){
      if(e.statusCode===402)wx.showModal({title:'积分不足',content:e.message,confirmText:'去充值',success:r=>{if(r.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});
      else api.handleAuthError(e)||wx.showToast({title:e.message,icon:'none'});
    }finally{this.setData({posting:false})}
  },
  async claim(e){
    if(!api.requireLogin())return;
    const id=e.currentTarget.dataset.id;
    try{
      const me=await api.get('/api/me'),cost=me.claimCost;
      if(typeof cost!=='number'||!Number.isFinite(cost))return wx.showToast({title:'接单规则暂不可用，请稍后重试',icon:'none'});
      if(me.points<cost)return wx.showModal({title:'积分不足',content:'接单需要 '+cost+' 积分，当前 '+me.points+' 积分。是否去充值？',confirmText:'去充值',success:r=>{if(r.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});
      wx.showModal({title:'确认接单',content:cost===0?'本次免扣积分。':'接单将扣除 '+cost+' 积分。放弃接单不会退还。',success:async r=>{
        if(!r.confirm)return;
        try{await api.post('/api/channels/'+encodeURIComponent(this.data.name)+'/messages/'+id+'/claim',{});wx.navigateTo({url:'/pages/trade/trade?id='+id+'&channel='+encodeURIComponent(this.data.name)})}
        catch(err){if(err.statusCode===402)wx.showToast({title:err.message,icon:'none'});else api.handleAuthError(err)||wx.showToast({title:err.message,icon:'none'})}
      }});
    }catch(err){api.handleAuthError(err)||wx.showToast({title:err.message,icon:'none'})}
  },
  refresh(){this.load(false)},
  openTrade(e){wx.navigateTo({url:'/pages/trade/trade?id='+e.currentTarget.dataset.id+'&channel='+encodeURIComponent(this.data.name)})}
});
