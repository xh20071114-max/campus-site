const api=require('../../utils/api');
const fmt=require('../../utils/format');
const icons={'校园跑':'🏃','校园配送':'🍱','代取快递':'📦','代课':'📚','代做作业':'📝'};

Page({
  data:{channels:[],announcements:[],allAnnouncements:[],expanded:false,tasks:[],username:''},
  onShow(){this.setData({username:wx.getStorageSync('username')||''});this.load()},
  async load(){
    try{
      const [channels,announcements,tasks]=await Promise.all([api.get('/api/channels'),api.get('/api/announcements'),api.get('/api/tasks?limit=6')]);
      const news=announcements.map(x=>({...x,date:fmt.date(x.time)}));
      this.setData({channels:channels.map(x=>({...x,icon:icons[x.name]||'🎓'})),allAnnouncements:news,announcements:this.data.expanded?news:news.slice(0,2),tasks:tasks.slice(0,6).map(x=>({...x,timeText:fmt.date(x.time)}))});
    }catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  toggleAnnouncements(){const expanded=!this.data.expanded;this.setData({expanded,announcements:expanded?this.data.allAnnouncements:this.data.allAnnouncements.slice(0,2)})},
  openChannel(e){wx.navigateTo({url:'/pages/channel/channel?name='+encodeURIComponent(e.currentTarget.dataset.name)})},
  openTask(e){const t=e.currentTarget.dataset;wx.navigateTo({url:'/pages/trade/trade?id='+t.id+'&channel='+encodeURIComponent(t.channel)})},
  openTasks(){wx.switchTab({url:'/pages/tasks/tasks'})},
  openOrders(){if(wx.getStorageSync('token'))wx.navigateTo({url:'/pages/orders/orders'});else wx.navigateTo({url:'/pages/login/login?next=orders'})},
  openLeaderboard(){wx.navigateTo({url:'/pages/leaderboard/leaderboard'})},
  openMe(){if(wx.getStorageSync('token'))wx.switchTab({url:'/pages/me/me'});else wx.navigateTo({url:'/pages/login/login'})}
});
