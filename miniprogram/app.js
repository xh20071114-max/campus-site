App({
  globalData: {apiBase:'https://plgslzlexpmy.sealoshzh.site',username:'',token:''},
  onLaunch() { this.syncSession(); },
  syncSession() { this.globalData.username=wx.getStorageSync('username')||'';this.globalData.token=wx.getStorageSync('token')||'';return this.globalData; },
  saveSession(data) { wx.setStorageSync('username',data.username);wx.setStorageSync('token',data.token);this.syncSession(); },
  clearSession() { wx.removeStorageSync('username');wx.removeStorageSync('token');this.syncSession(); }
});
