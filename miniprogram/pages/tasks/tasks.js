const api=require('../../utils/api');
const fmt=require('../../utils/format');

Page({
  data:{tasks:[],username:'',claimCost:null,feeReady:false,total:0,page:1,pages:1,error:''},
  onShow(){this.load()},
  async load(){
    const page=this.data.page,token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'',requestId=(this.loadRequestId||0)+1;
    this.loadRequestId=requestId;
    if(this.sessionToken!==token||this.sessionUsername!==username){this.sessionToken=token;this.sessionUsername=username;this.setData({username,claimCost:null,feeReady:false,error:''})}
    const isCurrent=()=>requestId===this.loadRequestId&&page===this.data.page&&token===(wx.getStorageSync('token')||'')&&username===(wx.getStorageSync('username')||'');
    try{

      const [d,s]=await Promise.all([api.get('/api/tasks?status=open&limit=10&page='+page),api.get('/api/settings')]);
      if(!isCurrent())return;
      const feeReady=typeof s.claimCost==='number'&&Number.isFinite(s.claimCost);
      let cost=feeReady?s.claimCost:null;
      if(token){
        try{const me=await api.get('/api/me');if(!isCurrent())return;if(typeof me.claimCost==='number'&&Number.isFinite(me.claimCost))cost=me.claimCost;else cost=null}
        catch(e){if(!isCurrent())return;if(api.handleAuthError(e)){this.loadRequestId++;this.sessionToken='';this.sessionUsername='';this.setData({feeReady:false,claimCost:null});return}cost=null}
      }
      if(!isCurrent())return;
      this.setData({tasks:(d.tasks||[]).map(x=>({...x,timeText:fmt.date(x.time)})),claimCost:cost,feeReady:cost!==null,total:d.total,pages:d.pages,error:''});
    }catch(e){if(!isCurrent())return;this.setData({feeReady:false,claimCost:null,error:e.message})}
  },
  sameSession(token,username){return !!token&&token===(wx.getStorageSync('token')||'')&&username===(wx.getStorageSync('username')||'')&&token===this.sessionToken&&username===this.sessionUsername},
  staleClaim(){wx.showToast({title:'账号已切换，请刷新后重试',icon:'none'});this.load()},
  async claim(e){
    if(!api.requireLogin())return;
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';
    if(!this.sameSession(token,username)){this.staleClaim();return}
    const id=e.currentTarget.dataset.id,ch=e.currentTarget.dataset.channel;
    try{
      const me=await api.get('/api/me');if(!this.sameSession(token,username)){this.staleClaim();return}const cost=me.claimCost;
      if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0||typeof me.points!=='number'||!Number.isFinite(me.points)||me.points<0)return wx.showToast({title:'接单规则或积分余额暂不可用，请稍后重试',icon:'none'});
      if(me.points<cost)return wx.showModal({title:'积分不足',content:'接单需要 '+cost+' 积分，当前 '+me.points+' 积分。现在前往充值吗？',confirmText:'去充值',success:r=>{if(r.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});
      wx.showModal({title:'确认接单',content:cost===0?'本次接单免扣积分。确认后请按订单流程完成交易。':'接单将扣除 '+cost+' 积分。放弃接单不退积分，确认继续吗？',success:async r=>{
        if(!r.confirm)return;
        if(!this.sameSession(token,username)){this.staleClaim();return}
        try{await api.post('/api/channels/'+encodeURIComponent(ch)+'/messages/'+id+'/claim',{}, {header:{Authorization:'Bearer '+token}});if(!this.sameSession(token,username))return;wx.showToast({title:'接单成功'});this.load();wx.navigateTo({url:'/pages/trade/trade?id='+id+'&channel='+encodeURIComponent(ch)})}
        catch(err){if(!this.sameSession(token,username)){this.staleClaim();return}if(err.statusCode===402)wx.showModal({title:'积分不足',content:err.message,confirmText:'去充值',success:x=>{if(x.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});else{api.handleAuthError(err)||wx.showToast({title:err.message,icon:'none'});this.load()}}
      }});
    }catch(err){if(!this.sameSession(token,username)){this.staleClaim();return}api.handleAuthError(err)||wx.showToast({title:err.message,icon:'none'})}
  },
  detail(e){wx.navigateTo({url:'/pages/trade/trade?id='+e.currentTarget.dataset.id+'&channel='+encodeURIComponent(e.currentTarget.dataset.channel)})},
  consult(e){if(!api.requireLogin())return;const t=e.currentTarget.dataset;wx.navigateTo({url:'/pages/trade/trade?id='+t.id+'&channel='+encodeURIComponent(t.channel)+'&inquiry=1'})},
  viewInquiries(e){if(!api.requireLogin())return;const t=e.currentTarget.dataset;wx.navigateTo({url:'/pages/trade/trade?id='+t.id+'&channel='+encodeURIComponent(t.channel)+'&inquiry=1'})},

  prev(){if(this.data.page>1){this.setData({page:this.data.page-1});this.load()}},
  next(){if(this.data.page<this.data.pages){this.setData({page:this.data.page+1});this.load()}},
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())}
});
