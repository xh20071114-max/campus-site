const api=require('../../utils/api');
const fmt=require('../../utils/format');

Page({
  data:{username:'',logged:false,points:0,ledger:[],error:''},
  onShow(){
    const session=this.syncSession();
    this.load(session.token,session.username);
  },
  syncSession(){
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';
    const changed=token!==this.sessionToken||username!==this.sessionUsername;
    if(changed){
      this.sessionToken=token;
      this.sessionUsername=username;
      this.loadRequestId=(this.loadRequestId||0)+1;
      this.setData({username,logged:!!token,points:0,ledger:[],error:''});
    }else this.setData({username,logged:!!token});
    return {token,username,changed};
  },
  sameSession(token,username){
    return token===(wx.getStorageSync('token')||'')&&username===(wx.getStorageSync('username')||'')&&token===this.sessionToken&&username===this.sessionUsername;
  },
  async load(sessionToken,sessionUsername){
    const token=sessionToken===undefined?(wx.getStorageSync('token')||''):sessionToken;
    const username=sessionUsername===undefined?(wx.getStorageSync('username')||''):sessionUsername;
    const requestId=(this.loadRequestId||0)+1;
    this.loadRequestId=requestId;
    this.sessionToken=token;
    this.sessionUsername=username;
    if(!token){this.setData({username:'',logged:false,points:0,ledger:[],error:''});return}
    const isCurrent=()=>requestId===this.loadRequestId&&this.sameSession(token,username);
    try{
      const [me,points]=await Promise.all([api.get('/api/me'),api.get('/api/my/points')]);
      if(!isCurrent())return;
      this.setData({username:me.username,logged:true,points:points.points,ledger:(points.log||[]).slice(0,20).map(x=>({...x,timeText:fmt.date(x.time)})),error:''});
    }catch(e){
      if(!isCurrent())return;
      if(api.handleAuthError(e)){this.syncSession();return}
      this.setData({error:e.message});
    }
  },
  login(){wx.navigateTo({url:'/pages/login/login'})},
  orders(){if(api.requireLogin())wx.navigateTo({url:'/pages/orders/orders'})},
  leaderboard(){wx.navigateTo({url:'/pages/leaderboard/leaderboard'})},
  recharge(){if(api.requireLogin())wx.navigateTo({url:'/pages/recharge/recharge'})},
  feedback(){
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';
    if(token!==this.sessionToken||username!==this.sessionUsername)this.syncSession();
    wx.showModal({title:'意见反馈',editable:true,placeholderText:'请描述建议或遇到的问题',success:async r=>{
      if(!r.confirm||!r.content.trim())return;
      if(!this.sameSession(token,username)){this.syncSession();return wx.showToast({title:'账号已切换，原反馈未提交',icon:'none'})}
      try{
        await api.post('/api/feedback',{text:r.content.trim(),contact:''},{header:{Authorization:token?'Bearer '+token:''}});
        if(!this.sameSession(token,username))return;
        wx.showToast({title:'已提交，感谢反馈'});
      }catch(e){
        if(!this.sameSession(token,username))return;
        if(api.handleAuthError(e)){this.syncSession();return}
        wx.showToast({title:e.message,icon:'none'});
      }
    }});
  },
  logout(){
    const session=this.syncSession(),{token,username}=session;
    if(!token)return wx.showToast({title:'当前未登录',icon:'none'});
    wx.showModal({title:'退出登录',content:'确认退出当前账号？',success:async r=>{
      if(!r.confirm)return;
      if(!this.sameSession(token,username)){this.syncSession();return wx.showToast({title:'账号已切换，原退出操作已取消',icon:'none'})}
      let request;
      try{request=api.post('/api/logout',{}, {header:{Authorization:'Bearer '+token}})}catch(e){}
      this.loadRequestId=(this.loadRequestId||0)+1;
      this.sessionToken='';
      this.sessionUsername='';
      this.setData({logged:false,username:'',points:0,ledger:[],error:''});
      getApp().clearSession();
      try{await request}catch(e){}
      wx.showToast({title:'已退出'});
    }});
  }
});
