# Aevon校园交流网

校园互助网站：门户首页、注册登录、五个项目频道（校园跑、食堂配送、代取快递、代课、代做作业），频道内可发任务、接单、完成，个人中心查看我发布的和我接的任务。

## 本地运行
需要 Node.js 18 以上，无第三方依赖。

    ./run.sh          # 守护运行，崩溃后自动重启
    # 或者 node server.js
    打开 http://localhost:3000

数据保存在 `data.json`（账号、登录状态、消息），请定期备份。

## 环境变量
- `PORT`：端口，默认 3000
- `ADMIN_PASSWORD`：设置后，启动时会直接建好管理员账号，别人就没法抢注了。账号已经存在时这一项不起作用，登录后可以在个人中心改密码。
- `TRUST_PROXY`：默认 1，部署在网关或反向代理后面时，按 `X-Forwarded-For` 最右边的 IP 做频率限制；直接对外、前面没有代理时设成 0。
- `ALLOW_ORIGINS`：允许跨域调用接口的前端地址，逗号分隔，默认 `https://plgslzlexpmy.sealoshzh.site`（前后端同域时用不到）

## 部署
- 前后端一起部署：把整个目录放到服务器上运行 `./run.sh`，`config.js` 里 `API_BASE` 留空。
- 前端放 GitHub Pages、后端单独部署：后端用 Dockerfile 部署到任意支持 Docker 的平台，再把 `config.js` 里的 `API_BASE` 填成后端公网地址。注意平台需要持久化磁盘，否则重启后 `data.json` 会丢。

## 接口
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/register、/api/login | `{username,password}` → `{token,username}`；用户名 2-16 位，密码至少 6 位 |
| POST | /api/logout | 退出，token 失效 |
| GET | /api/me | 当前用户 |
| GET | /api/channels | 频道列表和消息数 |
| GET | /api/channels/<频道>/messages?rev=<n> | 返回 rev 大于 n 的消息，响应头 `X-Rev` 为当前最大 rev |
| POST | /api/channels/<频道>/messages | `{text,task}` 发消息或任务 |
| POST | /api/channels/<频道>/messages/<id>/claim | 接单（不能接自己的） |
| POST | /api/channels/<频道>/messages/<id>/complete | 发布者确认完成（需已接单） |
| GET | /api/tasks?status=open\|claimed\|done\|all&limit= | 跨频道任务 |
| GET | /api/my/tasks | `{posted,claimed}` |

需要登录的接口请求头带 `Authorization: Bearer <token>`。token 7 天过期；登录和注册每 IP 每分钟 20 次，发消息每人每分钟 10 条，超出返回 429。

## 管理员（只有一个）
环境变量 `ADMIN=用户名`（写在 `.env` 或托管平台的环境变量里）。普通账号调用以下接口一律返回 403。

| 接口 | 说明 |
|---|---|
| GET /api/admin/overview | 用户、全部消息（含已删除，带 deletedText）、公告 |
| GET /api/admin/users | 用户列表：banned、banReason、activeSessions、messages |
| GET /api/admin/messages | 全部消息，带 channel，已删除的带 originalText |
| POST /api/admin/users/<用户名>/ban {reason} | 封禁（管理员不能被封） |
| POST /api/admin/users/<用户名>/unban | 解封 |
| POST /api/admin/users/<用户名>/delete | 删除账号：token 失效，消息标记已删除（原文留给管理员），未完成的任务撤销，接了的单放回待接单，用户名可重新注册 |
| POST /api/announcements、/api/announcements/<id>/delete | 发布、删除公告 |

被封的账号在登录、发消息、接单时返回 403 `{error:"账号已被封禁", banned:true}`，`/api/me` 里也带 `banned`。

## 一键部署（页面和后端放在同一台服务器）
`server.js` 会直接提供所有页面，所以 `config.js` 里的 `API_BASE` 留空就行。

**用 Docker（推荐）**
```
docker build -t aevon .
docker run -d --name aevon --restart=always -p 80:3000 -v aevon-data:/data -e ADMIN_PASSWORD=你的管理员密码 aevon
```
数据（`data.json` 和 `backups/`）都放在 `/data` 存储卷里，重新部署也不会丢。

**不用 Docker（需要 Node 18 以上）**
```
echo 'ADMIN=AevonEcho' > .env && echo 'ADMIN_PASSWORD=你的管理员密码' >> .env && echo 'DATA_DIR=/var/lib/aevon' >> .env
nohup ./run.sh &
```

**环境变量**
- `PORT`：端口，默认 3000。
- `DATA_DIR`：数据目录，默认是代码所在目录。
- `ADMIN`：唯一的管理员账号，默认 `AevonEcho`。
- `ADMIN_PASSWORD`：设置后，启动时会直接建好管理员账号，别人就没法抢注了。账号已经存在时这一项不起作用，登录后可以在个人中心改密码。
- `TRUST_PROXY`：默认 1，部署在网关或反向代理后面时，按 `X-Forwarded-For` 最右边的 IP 做频率限制；直接对外、前面没有代理时设成 0。
- `ALLOW_ORIGINS`：只有跨域访问时才需要。

**部署后检查**
打开 `http://服务器地址/api/health`，返回 `{"ok":true}` 就说明服务在运行。
如果没设 `ADMIN_PASSWORD`，部署完要马上用 `AevonEcho` 注册，免得被别人抢先注册。

## 积分
新用户注册送 `signupBonus` 积分。发任务扣 `postCost`，接单扣 `claimCost`，普通聊天不扣；管理员发任务、接单都不扣分。积分不够时返回 402 `{error, points, need}`。撤销没人接的任务，或者删掉没人接的任务，发布者的积分会退回来；放弃接单不退。管理员可以发带 `bonusPoints` 的积分任务，发布者确认完成后，奖励自动加给接单人。

| 接口 | 说明 |
|---|---|
| GET /api/settings | 公开，返回 {postCost, claimCost, signupBonus} |
| GET /api/my/points | 本人的余额和流水 {points, log:[{time,delta,balance,type,reason}]} |
| POST /api/recharge {amount, method:alipay\|wechat, note} | 提交充值，等待审核（每人最多 5 笔在审核中） |
| GET /api/my/recharges | 本人的充值记录 |
| GET/POST /api/admin/settings | 查看或修改三个积分配置 |
| GET /api/admin/recharges?status=pending | 充值审核列表 |
| POST /api/admin/recharges/<id>/approve {points} 或 /reject {reason} | 通过或拒绝充值 |
| POST /api/admin/users/<用户名>/points {delta, reason} | 手动加减积分，不能扣到负数 |

## 建议
| 接口 | 说明 |
|---|---|
| POST /api/feedback {text, contact?} | 需登录；内容最多 1000 字，每人每分钟最多 3 条；返回 {ok, id} |
| GET /api/admin/feedback | 仅管理员，[{id,user,text,contact,time,read}]，最新的在前 |
| POST /api/admin/feedback/<id>/read 或 /delete | 标为已读或删除 |

overview 里的 `unreadFeedback` 是未读建议的数量。普通用户看不到任何建议，包括自己发的。

## 任务私聊
| 接口 | 说明 |
|---|---|
| GET /api/tasks/<id>/chat?after=<消息id或时间> | 发布人、当前接单人和管理员可读，返回 {task:{...,canWrite}, messages:[{id,user,text,time,claimer,userDeleted?}]}；当事人读取后未读清零 |
| POST /api/tasks/<id>/chat {text} | 只有发布人和当前接单人能发；最多 500 字，每分钟 20 条；没人接返回 409，管理员返回 403 |
| GET /api/my/chat-unread | {任务id: 未读数} |
| GET /api/admin/chats | 管理员：所有有私聊的任务列表 |

任务列表、我的任务、频道消息里，当事人看到的任务会带 `chatUnread`。换了接单人以后，新接单人看不到前任接单人的对话，管理员都能看到。

## 任务状态补充
- `POST /api/channels/<ch>/messages/<id>/release`（也可以写 `kick`）：发布人取消接单人，任务回到待接单，退还接单人的接单积分（返回的任务带 `releasedBy`）。
- 已接单、没完成、超过截止时间 24 小时的任务带 `overdue:true`，发布人可以 `cancel`，会退还发布积分。
- 管理员删除已接单、没完成的任务时，发布积分和接单积分都退回。
- 频道消息：`?rev=0` 返回最近 50 条，`?before=<id>` 返回这条之前的 50 条；`/api/channels` 返回 `{name,count,lastId}`。
- 频道里普通用户只能发任务，发普通消息返回 403；管理员可以发普通消息，当公告用。
- `GET /api/channels/<ch>/notices?limit=50`：全站公告（type=global，带 title）和管理员在这个频道发的普通消息（type=channel）合并后按时间倒序返回，字段是 {id,type,title,text,user,time}。

## 交易流程和私聊图片
- 任务带 `status`：open → claimed → finished → paid → done，另外还有 cancelled（已撤回）和 closed（管理员关闭）。
- `POST /api/channels/<ch>/messages/<id>/finish`：接单人点「我已完成」。`/paid`：发布人点「我已付款」。`/received`：接单人点「确认收款」，任务变成 done，这时发奖励积分。`/complete`：发布人「无需付款，直接完成」，接单后任何阶段都能用。进入 finished 之后不能 kick、撤回或放弃接单。每一步都会在私聊里写一条系统消息（`type:'system'`）。
- `POST /api/admin/tasks/<id>/force {action:'done'|'close', reason}`：管理员强制完成（发奖励）或关闭任务（关闭时退还双方的发布分和接单分）。接单人在 finished 或 paid 状态下删号，任务保持原状态，标记 `claimerDeleted`，之后由发布人 complete，或者管理员 force 处理。
- `POST /api/tasks/<id>/chat/image`：请求体是 JPEG/PNG 二进制（Content-Type 填 image/*），或者 JSON `{data: base64 或 dataURL}`。不超过 300KB，后端检查文件头，每人每天最多 20 张，上传目录总量超过 500MB 返回 507。返回的私聊消息带 `image`（读图地址）。
- `GET /api/tasks/<id>/chat/image/<消息id>`：权限和读私聊一样。可以用 Authorization 头请求，前端用 fetch 带头请求，再转成 blob 显示（不支持在地址里带 token）。上传时 JSON 里可以带 `kind:"payqr"` 和 `text`（最多 100 字）。图片存在 `DATA_DIR/uploads/<任务id>/`，静态目录访问不到。

## 动态、互评、搜索、举报、备份
- `GET /api/my/events?after=<id>` → `{unread, events:[{id,type,taskId,channel,task,text,time,read}]}`，新的在前，每人保留最近 200 条。type 有 claim、unclaim、release、cancel、finish、paid、received、done、force、deleted、rated。`POST /api/my/events/read` 把全部标为已读。`/api/me` 带 `eventUnread` 和 `chatUnread`（私聊未读总数）。
- `POST /api/channels/<ch>/messages/<id>/rate {score:1-5, comment≤80}`：任务 done 后双方各评一次，评过的记在任务的 `ratings.poster/claimer` 上。`GET /api/users/<name>/profile` → `{username,admin,completed,posted,ratingCount,avgScore,goodRate,recent}`。
- 频道消息和 `/api/tasks` 支持 `?q=关键词`（匹配内容、地点、悬赏）和 `?sort=new|reward|deadline`；带了这两个参数时只返回进行中的任务，最多 limit 条（1-100，默认 50）。
- `POST /api/report {target:'user'|'task', id, reason}`，每人每分钟最多 3 条。管理员接口：`GET /api/admin/reports`、`POST /api/admin/reports/<id>/resolve {note}`、`/delete`。overview 带 `unreadReports`。
- `GET /api/admin/backup`：下载 `aevon-backup-YYYY-MM-DD.json`，不含 sessions（登录令牌），也不含图片。
- `sw.js`：service worker，只缓存静态文件，/api 和 admin 都不缓存。

## 纠纷、自动确认、数据安全、图片清理
- 「无需付款，直接完成」（complete/done）只能在 claimed 状态用，finished、paid 时返回 409。
- paid 状态超过 48 小时没确认收款，系统会自动完成任务：任务带 `autoConfirmed:true`，并写一条系统消息，双方各收到一条 `auto` 动态。这个检查每 10 分钟跑一次。
- `POST /api/channels/<ch>/messages/<id>/dispute {reason}`：发布人或接单人在 claimed、finished、paid 状态下都能发起。
  - 发起后 `status` 变成 `disputed`，任务带 `dispute:{by,role,reason,time,from}`，对方收到一条 `dispute` 动态。
  - 之后所有状态动作都返回 409，也不会自动确认收款，只能由管理员用 `/api/admin/tasks/<id>/force` 处理。处理后 `dispute` 里会补上 `resolvedAt`、`resolution`、`resolvedBy` 和 `note`。私聊不受影响。
  - `GET /api/admin/disputes` 列出所有有过纠纷的任务，没处理的排在前面，每条带 `resolved` 和 `chatCount`。overview 带 `disputes`（待处理数）。
- 发布人删号时，处在 finished 或 paid 的任务不会撤销，而是转成 disputed，`dispute.role` 为 `system`，原因是「发布人已注销」。删号接口返回值里多一个 `disputedTasks`。
- 评价规则：
  - 有过纠纷的任务不能评价。
  - 计入信用的评价，同一个评价人只算最新的 1 次；评价双方的 IP 有重叠的不算。
  - profile 里的 `ratingCount`、`avgScore`、`goodRate` 只按计入的评价算，`ratingTotal` 是全部评价数，`recent` 每条带 `counted`。
- 启动安全：
  - data.json 解析失败时，先改名为 `data.corrupt-<时间>.json`，再从 backups 里最新一份能解析的备份恢复。
  - 都不行就拒绝启动，日志里会写明原因。之后重启也不会用空库顶替。
  - 每次备份前也会先校验数据能不能解析。
- 图片：
  - 删除任务时，这个任务的图片一起删掉。
  - 删除账号时，他发布的任务的图片、以及他被放回的接单对话里的图片都会删掉。
  - 任务结束 30 天后自动清理图片，每小时检查一次。被清理的消息带 `imageRemoved:true`，不再有 `image` 字段。
  - 每人最多存 20MB 图片，超过返回 409。
  - overview 带 `disk:{uploads,uploadsMax,data,backups,free,size}`，单位都是字节。
- 后台备份下载里不包含 `ips`。
- 其他：任务按 id 建了索引，私聊未读数改成增量维护。
- 补充：接单人在 finished 或 paid 删号，也会转成 disputed，原因是「接单人已注销」。有纠纷的任务带 `disputeReason`、`disputeBy`（系统发起时为「系统」）和 `disputedAt`。overview 的 `disk` 里另有 `uploadBytes`、`uploadLimit`、`dataBytes`。发布人和接单人都能发收款码（payqr）。
- 更正：IP 重叠的评价照常计入信用，只在 `/api/admin/messages` 的任务上带 `ipOverlap:true`，提示管理员双方 IP 相同；公开接口不返回这个字段。私聊里双方都能发任何图片，包括收款码（payqr），后端不限制。

## 讨价接单
- `POST /api/channels/<ch>/messages/<id>/offer {price, note≤50}`：price 是人民币金额，范围 0.01-100000。发起讨价不扣积分，返回 `{offer, task}`。
- `GET .../offers` 返回 `{count, offers}`。发布人和管理员能看到全部讨价，讨价人只能看到自己的，其他人只能看到 `count`。任务对象上的 `offerCount` 是进行中的讨价数。
- `POST .../offers/<oid>/accept|reject|counter|withdraw`：
  - reject 只有发布人能用，withdraw 只有讨价人能用。
  - counter `{price, note}` 和 accept 都要轮到自己才能用：`turn` 为 `poster` 时轮到发布人，为 `claimer` 时轮到讨价人。
  - 每次出价最多 6 次（来回 3 轮）。
  - accept 等于讨价人按当前价格接单，当场扣接单积分，积分不够返回 402。成交后任务带 `originalReward`、`negotiated:true` 和 `offerId`，`reward` 改成「X元」，私聊里写一条「双方已议价 X 元」。
- offer 对象：`{id, user, status: pending|accepted|rejected|withdrawn|expired, price, turn, rounds:[{by:'claimer'|'poster', price, note, time}], time, updated, reason?}`。
- 限制：每人对同一个任务只能有 1 个进行中的讨价，一个任务同时最多 10 个，发布人和管理员不能讨价。
- 失效：任务被接走、撤回、被删除、被管理员关闭、过了截止时间，或者发布人删号时，所有进行中的讨价都变成 `expired`，并给讨价人发一条动态。截止时间每 10 分钟检查一次，有人操作时也会当场检查。
- 动态类型：offer、offer_counter、offer_accept、offer_reject、offer_withdraw、offer_expire。
- 讨价兼容字段：offer 上还带 `note`（最新留言）、`round`（1-3 轮）、`maxRound`、`counter`（发布人最新还价）、`myTurn`、`canCounter`、`history:[{by,action:offer|counter|accept|reject|withdraw|expire,price,note,time}]`。已有还价、还没结束的 offer，`status` 是 `countered`，原始状态在 `rawStatus`。任务上带 `myOffer:{id,price,counter,status,round,myTurn,canCounter}`，只给讨价人自己看。
- 注册接口可以带 `password2`，修改密码接口可以带 `newPassword2`。传了就会校验，两次不一致时返回 400「两次输入的密码不一致」；不传就不校验，兼容旧页面。
- 管理员看到的任务数据带 `offerTotal`，是讨价总条数，包含已失效和被拒的。`offerCount` 仍然只算进行中的讨价。
