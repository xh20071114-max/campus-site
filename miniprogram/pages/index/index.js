const api=require('../../utils/api');
const fmt=require('../../utils/format');
const icons={'校园跑':'🏃','校园配送':'🍱','代取快递':'📦','代课':'📚','代做作业':'📝'};

Page({
  data:{channels:[],announcements:[],allAnnouncements:[],expanded:false,tasks:[],username:'',loadError:''},
  onShow(){this.setData({username:wx.getStorageSync('username')||''});this.load()},
  async load(){
    const settle=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}));
    const [channels,announcements,tasks]=await Promise.all([
      settle(api.get('/api/channels')),
      settle(api.get('/api/announcements')),
      settle(api.get('/api/tasks?limit=6'))
    ]);
    const updates={},failed=[];
    if(channels.ok)updates.channels=channels.value.map(x=>({...x,icon:icons[x.name]||'🎓'}));else failed.push('频道');
    if(announcements.ok){
      const news=announcements.value.map(x=>({...x,date:fmt.date(x.time)}));
      updates.allAnnouncements=news;
      updates.announcements=this.data.expanded?news:news.slice(0,2);
    }else failed.push('公告');
    if(tasks.ok)updates.tasks=tasks.value.slice(0,6).map(x=>({...x,timeText:fmt.date(x.time)}));else failed.push('任务');
    updates.loadError=failed.length?`部分信息加载失败（${failed.join('、')}），点击重试` : '';
    this.setData(updates);
  },
  toggleAnnouncements(){const expanded=!this.data.expanded;this.setData({expanded,announcements:expanded?this.data.allAnnouncements:this.data.allAnnouncements.slice(0,2)})},
  openChannel(e){wx.navigateTo({url:'/pages/channel/channel?name='+encodeURIComponent(e.currentTarget.dataset.name)})},
  openTask(e){const t=e.currentTarget.dataset;wx.navigateTo({url:'/pages/trade/trade?id='+t.id+'&channel='+encodeURIComponent(t.channel)})},
  openTasks(){wx.switchTab({url:'/pages/tasks/tasks'})},
  openOrders(){if(wx.getStorageSync('token'))wx.navigateTo({url:'/pages/orders/orders'});else wx.navigateTo({url:'/pages/login/login?next=orders'})},
  openLeaderboard(){wx.navigateTo({url:'/pages/leaderboard/leaderboard'})},
  openMe(){if(wx.getStorageSync('token'))wx.switchTab({url:'/pages/me/me'});else wx.navigateTo({url:'/pages/login/login'})}
});
