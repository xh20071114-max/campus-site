const api=require('../../utils/api');
const fmt=require('../../utils/format');

Page({
  data:{tasks:[],claimCost:null,feeReady:false,total:0,page:1,pages:1,error:''},
  onShow(){this.load()},
  async load(){
    try{
      const [d,s]=await Promise.all([api.get('/api/tasks?status=open&limit=10&page='+this.data.page),api.get('/api/settings')]);
      const feeReady=typeof s.claimCost==='number'&&Number.isFinite(s.claimCost);
      let cost=feeReady?s.claimCost:null;
      if(wx.getStorageSync('token')){
        try{const me=await api.get('/api/me');if(typeof me.claimCost==='number'&&Number.isFinite(me.claimCost))cost=me.claimCost;else cost=null}
        catch(e){if(api.handleAuthError(e))return;cost=null}
      }
      this.setData({tasks:(d.tasks||[]).map(x=>({...x,timeText:fmt.date(x.time)})),claimCost:cost,feeReady:cost!==null,total:d.total,pages:d.pages,error:''});
    }catch(e){this.setData({feeReady:false,claimCost:null,error:e.message})}
  },
  async claim(e){
    if(!api.requireLogin())return;
    const id=e.currentTarget.dataset.id,ch=e.currentTarget.dataset.channel;
    try{
      const me=await api.get('/api/me'),cost=me.claimCost;
      if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0||typeof me.points!=='number'||!Number.isFinite(me.points)||me.points<0)return wx.showToast({title:'接单规则或积分余额暂不可用，请稍后重试',icon:'none'});
      if(me.points<cost)return wx.showModal({title:'积分不足',content:'接单需要 '+cost+' 积分，当前 '+me.points+' 积分。现在前往充值吗？',confirmText:'去充值',success:r=>{if(r.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});
      wx.showModal({title:'确认接单',content:cost===0?'本次接单免扣积分。确认后请按订单流程完成交易。':'接单将扣除 '+cost+' 积分。放弃接单不退积分，确认继续吗？',success:async r=>{
        if(!r.confirm)return;
        try{await api.post('/api/channels/'+encodeURIComponent(ch)+'/messages/'+id+'/claim',{});wx.showToast({title:'接单成功'});this.load();wx.navigateTo({url:'/pages/trade/trade?id='+id+'&channel='+encodeURIComponent(ch)})}
        catch(err){if(err.statusCode===402)wx.showModal({title:'积分不足',content:err.message,confirmText:'去充值',success:x=>{if(x.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});else{api.handleAuthError(err)||wx.showToast({title:err.message,icon:'none'});this.load()}}
      }});
    }catch(err){api.handleAuthError(err)||wx.showToast({title:err.message,icon:'none'})}
  },
  detail(e){wx.navigateTo({url:'/pages/trade/trade?id='+e.currentTarget.dataset.id+'&channel='+encodeURIComponent(e.currentTarget.dataset.channel)})},
  prev(){if(this.data.page>1){this.setData({page:this.data.page-1});this.load()}},
  next(){if(this.data.page<this.data.pages){this.setData({page:this.data.page+1});this.load()}},
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())}
});
