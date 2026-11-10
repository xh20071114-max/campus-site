const api=require('../../utils/api');
const fmt=require('../../utils/format');

Page({
  data:{all:[],active:[],history:[],visible:[],view:'active',username:'',error:''},
  onLoad(q){if(q.view==='history')this.setData({view:'history'})},
  onShow(){this.load()},
  sameSession(token,username){
    return !!token&&token===(wx.getStorageSync('token')||'')&&username===(wx.getStorageSync('username')||'')&&token===this.sessionToken&&username===this.sessionUsername;
  },
  clearOrders(){
    this.setData({all:[],active:[],history:[],visible:[],error:''});
  },
  async load(){
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'',requestId=(this.loadRequestId||0)+1;
    this.loadRequestId=requestId;
    if(token!==this.sessionToken||username!==this.sessionUsername){
      this.sessionToken=token;
      this.sessionUsername=username;
      this.clearOrders();
    }
    if(this.data.username!==username)this.setData({username});
    if(!api.requireLogin()){this.clearOrders();return}
    const isCurrent=()=>requestId===this.loadRequestId&&this.sameSession(token,username);
    try{
      const d=await api.get('/api/my/tasks?includeHistory=1');
      if(!isCurrent())return;
      const rows=[...(d.posted||[]),...(d.claimed||[])];
      const unique=Array.from(new Map(rows.map(x=>[String(x.id),x])).values());
      const active=unique.filter(x=>!x.formerClaim&&!['done','cancelled','closed'].includes(x.status)&&!x.deleted).map(x=>this.decorate(x,username));
      const history=unique.filter(x=>x.formerClaim||['done','cancelled','closed'].includes(x.status)||x.deleted).map(x=>this.decorate(x,username));
      this.setData({all:unique,active,history,visible:this.data.view==='active'?active:history,error:''});
    }catch(e){
      if(!isCurrent())return;
      if(api.handleAuthError(e)){
        this.loadRequestId++;
        this.sessionToken='';
        this.sessionUsername='';
        this.clearOrders();
        return;
      }
      this.setData({error:e.message});
    }
  },
  decorate(x,username){
    const former=!!x.formerClaim;
    return {...x,statusText:former?'已结束（历史接单）':fmt.status(x.status),timeText:fmt.date(x.time),roleText:former?'曾接单（订单已重新分配）':x.user===username?'我发布':'我接单'};
  },
  switchView(e){
    const view=e.currentTarget.dataset.view;
    this.setData({view,visible:view==='active'?this.data.active:this.data.history});
  },
  openTrade(e){
    wx.navigateTo({url:'/pages/trade/trade?id='+e.currentTarget.dataset.id+'&channel='+encodeURIComponent(e.currentTarget.dataset.channel)});
  },
  openInquiries(e){
    if(!api.requireLogin())return;
    const t=e.currentTarget.dataset;
    wx.navigateTo({url:'/pages/trade/trade?id='+t.id+'&channel='+encodeURIComponent(t.channel)+'&inquiry=1'});
  },
  openInquiries(e){
    if(!api.requireLogin())return;
    const t=e.currentTarget.dataset;
    wx.navigateTo({url:'/pages/trade/trade?id='+t.id+'&channel='+encodeURIComponent(t.channel)+'&inquiry=1'});
  },
  restore(e){
    if(!api.requireLogin())return;
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';
    if(!this.sameSession(token,username)){this.load();return wx.showToast({title:'账号已切换，请刷新订单后重试',icon:'none'})}
    const id=e.currentTarget.dataset.id,ch=e.currentTarget.dataset.channel;
    wx.showModal({title:'恢复订单',content:'如果删除时已退还发布积分，恢复会重新扣回。积分不足时无法恢复。',success:async r=>{
      if(!r.confirm)return;
      if(!this.sameSession(token,username)){this.load();return wx.showToast({title:'账号已切换，原操作已取消',icon:'none'})}
      try{
        await api.post('/api/channels/'+encodeURIComponent(ch)+'/messages/'+id+'/restore',{}, {header:{Authorization:'Bearer '+token}});
        if(!this.sameSession(token,username))return;
        wx.showToast({title:'订单已恢复'});
        this.load();
      }catch(err){
        if(!this.sameSession(token,username))return;
        if(api.handleAuthError(err)){
          this.loadRequestId++;
          this.sessionToken='';
          this.sessionUsername='';
          this.clearOrders();
          return;
        }
        wx.showToast({title:err.message,icon:'none'});
      }
    }});
  },
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())}
});
