const api=require('../../utils/api');
const fmt=require('../../utils/format');

Page({
  data:{username:'',amount:'',note:'',method:'alipay',qrUrl:'',records:[],busy:false,error:''},
  onLoad(){
    this.sessionToken=wx.getStorageSync('token')||'';
    this.sessionUsername=wx.getStorageSync('username')||'';
    this.setData({username:this.sessionUsername,qrUrl:getApp().globalData.apiBase+'/pay-alipay.png'});
  },
  onShow(){
    this.syncSession();
    if(api.requireLogin())this.load();
  },
  syncSession(){
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';
    const changed=token!==this.sessionToken||username!==this.sessionUsername;
    if(changed){
      this.sessionToken=token;
      this.sessionUsername=username;
      this.loadRequestId=(this.loadRequestId||0)+1;
      this.submitRequestId=(this.submitRequestId||0)+1;
      this.setData({username,amount:'',note:'',records:[],error:'',busy:false});
    }else if(this.data.username!==username)this.setData({username});
    return {token,username,changed};
  },
  sameSession(token,username){
    return !!token&&token===(wx.getStorageSync('token')||'')&&username===(wx.getStorageSync('username')||'')&&token===this.sessionToken&&username===this.sessionUsername;
  },
  onAmount(e){this.setData({amount:e.detail.value})},
  onNote(e){this.setData({note:e.detail.value})},
  selectMethod(e){
    const method=e.currentTarget.dataset.method;
    this.setData({method,qrUrl:getApp().globalData.apiBase+(method==='wechat'?'/pay-wechat.png':'/pay-alipay.png')});
  },
  async load(){
    const session=this.syncSession();
    if(!session.token)return;
    const {token,username}=session,requestId=(this.loadRequestId||0)+1;
    this.loadRequestId=requestId;
    const isCurrent=()=>requestId===this.loadRequestId&&this.sameSession(token,username);
    try{
      const response=await api.request('/api/my/recharges',{header:{Authorization:'Bearer '+token}});
      if(!isCurrent())return;
      const rows=Array.isArray(response.data)?response.data:[];
      this.setData({records:rows.map(x=>({...x,statusText:({pending:'待审核',approved:'已通过',rejected:'已拒绝'})[x.status]||x.status,timeText:fmt.date(x.time)})),error:''});
    }catch(e){
      if(!isCurrent())return;
      if(api.handleAuthError(e)){this.syncSession();return}
      this.setData({error:e.message});
    }
  },
  async submit(){
    if(this.data.busy)return;
    const session=this.syncSession();
    if(!session.token){api.requireLogin();return}
    if(session.changed)return wx.showToast({title:'账号已切换，请核对充值信息后重试',icon:'none'});
    const {token,username}=session;
    if(!this.sameSession(token,username))return wx.showToast({title:'登录状态已变化，请刷新后重试',icon:'none'});
    const amount=Number(this.data.amount);
    if(!Number.isFinite(amount)||amount<.01)return wx.showToast({title:'请输入有效金额',icon:'none'});
    const requestId=(this.submitRequestId||0)+1;
    this.submitRequestId=requestId;
    this.setData({busy:true});
    try{
      await api.post('/api/recharge',{amount,method:this.data.method,note:this.data.note.trim()},{header:{Authorization:'Bearer '+token}});
      if(!this.sameSession(token,username))return;
      wx.showToast({title:'申请已提交'});
      this.setData({amount:'',note:''});
      await this.load();
    }catch(e){
      if(!this.sameSession(token,username))return;
      if(api.handleAuthError(e)){this.syncSession();return}
      wx.showToast({title:e.message,icon:'none'});
      if(e.statusCode!==401)this.setData({error:e.message});
    }finally{
      if(requestId===this.submitRequestId)this.setData({busy:false});
    }
  }
});
