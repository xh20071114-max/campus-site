const names={open:'待接单',claimed:'进行中',finished:'待发布人确认',paid:'待接单人确认到账',free_pending:'待接单人确认免付款',done:'已完成',cancelled:'已撤销',closed:'已关闭',disputed:'处理中'};
function status(value){return names[value]||'进行中'}
function date(value){if(!value)return '';const d=new Date(value);return isNaN(d.getTime())?'':d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
module.exports={status,date};
