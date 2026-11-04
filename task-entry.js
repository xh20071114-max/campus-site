// 统一的未接订单入口；保持文字可见，并让交易窗口和其他弹窗覆盖它。
(()=>{
 if(document.getElementById('openTaskHall'))return;
 const css=document.createElement('style');css.textContent='#openTaskHall{position:fixed;right:18px;bottom:calc(132px + env(safe-area-inset-bottom,0px));z-index:30;display:inline-flex;align-items:center;min-height:44px;padding:10px 15px;border-radius:24px;background:#047857;color:#fff;box-shadow:0 4px 14px #0003;text-decoration:none;font:600 14px/1.5 -apple-system,"Microsoft YaHei",sans-serif}#openTaskHall:hover{background:#065f46}#openTaskHall:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}@media(max-width:640px){#openTaskHall{right:12px;padding:10px 12px}}';document.head.append(css);
 const link=document.createElement('a');link.id='openTaskHall';link.href='tasks.html';link.textContent='📋 未接订单';link.setAttribute('aria-label','📋 未接订单');link.title='查看所有频道尚未被接取的任务';const slot=document.getElementById('taskHallSlot')||document.getElementById('quickActions');if(slot){link.className=slot.id==='taskHallSlot'?'home-tool':'inSlot';slot.append(link)}else document.body.append(link);
})();
