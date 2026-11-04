App({
  globalData: {apiBase:'https://plgslzlexpmy.sealoshzh.site',username:'',token:''},
  onLaunch() {
    if (typeof wx.onNeedPrivacyAuthorization === 'function') {
      wx.onNeedPrivacyAuthorization(resolve => {
        const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
        const page = pages[pages.length - 1];
        const popup = page && typeof page.selectComponent === 'function' ? page.selectComponent('#privacyPopup') : null;
        if (popup && typeof popup.requestAuthorization === 'function') popup.requestAuthorization(resolve);
        else resolve({event:'disagree'});
      });
    }
    this.syncSession();
  },
  syncSession() {
    this.globalData.username = wx.getStorageSync('username') || '';
    this.globalData.token = wx.getStorageSync('token') || '';
    return this.globalData;
  },
  saveSession(data) {
    wx.setStorageSync('username', data.username);
    wx.setStorageSync('token', data.token);
    this.syncSession();
  },
  clearSession() {
    wx.removeStorageSync('username');
    wx.removeStorageSync('token');
    this.syncSession();
  }
});
