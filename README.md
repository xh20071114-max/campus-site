# Aevon校园交流网

校园互助网站：门户首页、注册登录、五个项目频道（校园跑、食堂配送、代取快递、代课、代做作业），频道内可发任务、接单、完成，个人中心查看我发布的和我接的任务。

## 本地运行
需要 Node.js 20 以上，运行服务无第三方依赖；浏览器回归测试使用开发依赖 Playwright。

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
| GET | /api/my/saved | 当前账号收藏的任务 |
| POST | /api/my/saved/<任务ID> | `{saved:true\|false}` 收藏或取消收藏；每个账号最多 200 个 |

需要登录的接口请求头带 `Authorization: Bearer <token>`。token 7 天过期，每账号最多保留 10 个登录。登录、注册和修改密码共用每 IP 每分钟 60 次限额；登录另有同账号同 IP 15 分钟 10 次失败、跨 IP 合计 50 次失败限制（历史成功 IP 豁免后者）。频道发布每人每分钟 10 条，超出返回 429。

## 总管理员与权限授权
环境变量 `ADMIN=用户名` 指定唯一总管理员，默认精确匹配 `AevonEcho`，区分大小写。已有账号自动保留总管理员身份。总管理员在管理后台「管理员授权」中搜索用户、勾选权限并保存；取消全部权限即撤销管理员身份。普通管理员不能授权、撤权或变更总管理员身份，完整备份也仅限总管理员。

可分别授予 17 项权限：查看用户、封禁/解封、删除用户、调整积分、查看消息/议价、删除消息/任务、查看私聊/图片、参与任务私聊、管理公告、审核充值、修改积分规则、发布积分奖励任务、处理建议、处理举报、处理纠纷、发布频道通知、免任务手续费。封禁/删除/调整积分含查看用户，删除消息含查看消息；其他权限独立。普通管理员不能封禁、删除管理员或直接调整管理员积分；总管理员可以管理普通管理员，总管理员账号始终受保护。

权限在服务端逐项检查，撤权对原登录会话立即生效；页面在下次操作或定时核对身份后刷新。权限绑定账号记录，删除后同名新账号不继承。下文「管理员」均指总管理员或获授对应权限的管理员。

| 授权接口（仅总管理员） | 说明 |
|---|---|
| GET /api/admin/roles | 权限目录与账号当前权限、userId、permissionsVersion |
| POST /api/admin/users/<用户名>/permissions | `{permissions:[权限键],userId,version}`；空数组撤权，账号或版本变化返回 409 |

`GET /api/me` 与登录返回 `admin`、`superAdmin`、`permissions`。全量 `/api/admin/overview` 仅总管理员可用，普通管理员使用 `?summary=1`，只返回获授权项目的计数。

| 接口 | 说明 |
|---|---|
| GET /api/admin/overview | 用户、全部消息（含已删除，带 deletedText）、公告 |
| GET /api/admin/users | 用户列表：banned、banReason、activeSessions、messages |
| GET /api/admin/messages | 全部消息，带 channel，已删除的带 originalText |
| POST /api/admin/users/<用户名>/ban {reason} | 封禁（总管理员不能被封；普通管理员只能封禁普通用户） |
| POST /api/admin/users/<用户名>/unban | 解封 |
| POST /api/admin/users/<用户名>/delete | 删除账号：token 失效，消息标记已删除（原文留给管理员），未完成的任务撤销，接了的单放回待接单，用户名可重新注册 |
| POST /api/announcements、/api/announcements/<id>/delete | 发布、删除公告 |

被封的账号在登录、发消息、接单时返回 403。密码验证成功的封禁登录额外返回封禁原因、公开联系方式及申诉凭证；`/api/me` 也带 `banned`、`banReason`、`contact`。仅总管理员可在积分设置里填写公开的 `contactInfo`（最多 200 字），登录页和个人中心会显示。未配置时可使用站内联系入口。

## 一键部署（页面和后端放在同一台服务器）
`server.js` 会直接提供所有页面，所以 `config.js` 里的 `API_BASE` 留空就行。

**用 Docker（推荐）**
```
docker build -t aevon .
docker run -d --name aevon --restart=always -p 80:3000 -v aevon-data:/data -e ADMIN_PASSWORD=你的管理员密码 aevon
```
数据（`data.json` 和 `backups/`）都放在 `/data` 存储卷里，重新部署也不会丢。

**不用 Docker（需要 Node.js 20 以上）**
```
echo 'ADMIN=AevonEcho' > .env && echo 'ADMIN_PASSWORD=你的管理员密码' >> .env && echo 'DATA_DIR=/var/lib/aevon' >> .env
nohup ./run.sh &
```

**环境变量**
- `PORT`：端口，默认 3000。
- `DATA_DIR`：数据目录，默认是代码所在目录。
- `ADMIN`：唯一的总管理员账号，默认 `AevonEcho`。
- `ADMIN_PASSWORD`：设置后，启动时会直接建好管理员账号，别人就没法抢注了。账号已经存在时这一项不起作用，登录后可以在个人中心改密码。
- `TRUST_PROXY`：默认 1，部署在网关或反向代理后面时，按 `X-Forwarded-For` 最右边的 IP 做频率限制；直接对外、前面没有代理时设成 0。
- `ALLOW_ORIGINS`：只有跨域访问时才需要。

**部署后检查**
打开 `http://服务器地址/api/health`，返回 `{"ok":true}` 就说明服务在运行。
如果没设 `ADMIN_PASSWORD`，部署完要马上用 `AevonEcho` 注册，免得被别人抢先注册。

## 积分
新用户注册送 `signupBonus` 积分。发任务扣 `postCost`，接单扣 `claimCost`，普通聊天不扣；总管理员和获授「免任务手续费」的管理员不扣分，其他管理员照常扣分。积分不够时返回 402 `{error, points, need}`。撤销没人接的任务，或者删掉没人接的任务，发布者的积分会退回来；放弃接单不退。获授「发布积分奖励任务」的管理员可以设置 `bonusPoints`，发布者确认完成后奖励自动加给接单人。

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

## 联系管理员与封禁申诉

所有页面（含登录页）有「联系管理员」。正常登录可留言，并在同一入口刷新查看回复；总管理员及有 `manageFeedback` 权限的管理员在后台「建议/联系」中回复。联系留言仅本人及获授权管理员可见，与原有单向建议分开。每人每分钟最多 3 条、每天最多 10 条，每条最多 1000 字。

封禁账号在登录页输入正确的原账号密码后仍返回 403，不获得正常登录会话，但可点击「联系管理员 / 申诉」。系统签发 15 分钟、仅用于 `/api/support` 的凭证；不能发任务、接单或访问管理接口。过期、服务重启、密码改变、解封、重新封禁或删号后须重新验证，凭证不写入 localStorage。申诉不会自动解封账号。

| 接口 | 说明 |
|---|---|
| GET /api/support | 使用正常或申诉凭证，仅返回本人最近 50 条联系留言及回复 |
| POST /api/support | `{text,contact?}` 创建联系留言 |
| POST /api/admin/feedback/<id>/reply | `{text}` 管理员回复联系留言；原账号已注销时拒绝回复同名新账号 |

授权页面改为搜索框加账号选择栏，一次编辑一个账号；未保存的勾选在切换账号及当前页面刷新数据时保留（不跨浏览器刷新保存）。已封禁账号明确提示先解封，权限勾选区域扩大到适合手机点按的尺寸。保存时校验账号 ID 和版本，防止覆盖其他操作。

## 任务私聊
| 接口 | 说明 |
|---|---|
| GET /api/tasks/<id>/chat?after=<消息id或时间> | 发布人、当前接单人和管理员可读，返回 {task:{...,canWrite}, messages:[{id,user,text,time,claimer,userDeleted?}]}；当事人读取后未读清零 |
| POST /api/tasks/<id>/chat {text} | 只有发布人和当前接单人能发；最多 500 字，每分钟 20 条；没人接返回 409，管理员返回 403 |
| GET /api/my/chat-unread | {任务id: 未读数} |
| GET /api/admin/chats | 管理员：所有有私聊的任务列表 |

任务列表、我的任务、频道消息里，当事人看到的任务会带 `chatUnread`。换了接单人以后，新接单人看不到前任接单人的对话，获授查看权限的管理员能查看历史。

### 管理员参与交易聊天

总管理员可参与进行中订单的私聊；普通管理员须由总管理员勾选 `joinChats`（参与任务私聊），该权限包含查看。`viewChats` 保持只读，原有获授该权限的账号不会自动获得发言权。管理员可从后台私聊列表、消息/纠纷页或频道进入交易聊天，发送文字和图片；非交易双方的管理员消息带服务端生成的 `moderator:true`，双方可见管理员标记，并收到未读计数。管理员不会因此成为发布人或接单人，不能冒充双方。

订单已结束、撤销或删除时，旁观管理员只能查看；撤销授权会在请求执行和图片上传完成后重新检查。后台私聊每 4 秒读取新消息，关闭窗口会停止轮询并释放图片。

### 我的订单窗口

首页、频道及个人中心提供「我的订单」。窗口分进行中和历史订单，显示数量、待办、报酬、状态、交易双方、地点、截止时间和下一步操作，支持发布/接单角色筛选、搜索及每页 20 条展示；进行中包含待接单、已接单、待付款、待收款和纠纷，历史包含完成、撤销、关闭、过期及本人已删除任务的状态记录。

`GET /api/my/tasks?includeHistory=1` 包含本人已删除任务的状态，原接口不带参数时保持不返回已删除任务。`GET /api/tasks/<id>` 只允许当前交易当事人或获授权管理员读取订单，已删除任务不会向普通用户恢复原文。`chat.html?task=<id>#<频道>` 可直接打开交易聊天，不依赖该任务仍在最近频道缓存里。

频道消息区可收藏任务，并在「⭐ 我的收藏」中跨频道查看。收藏与账号 ID 绑定，不会因用户名被重新注册而转移；每个账号最多收藏 200 个任务。

## 任务状态补充
- `POST /api/channels/<ch>/messages/<id>/release`（也可以写 `kick`）：发布人取消接单人，任务回到待接单，退还接单人的接单积分（返回的任务带 `releasedBy`）。
- 已接单、没完成、超过截止时间 24 小时的任务带 `overdue:true`，发布人可以 `cancel`，会退还发布积分。
- 管理员删除或关闭任务时，只有勾选 `refundPost` / `refundClaim` 才退还对应积分；已经退款或已注销的账号不会再退款。
- 频道消息：`?rev=0` 返回最近 50 条，`?before=<id>` 返回这条之前的 50 条；`/api/channels` 返回 `{name,count,lastId}`。
- 频道里普通用户只能发任务，发普通消息返回 403；管理员可以发普通消息，当公告用。
- `GET /api/channels/<ch>/notices?limit=50`：全站公告（type=global，带 title）和管理员在这个频道发的普通消息（type=channel）合并后按时间倒序返回，字段是 {id,type,title,text,user,time}。

## 交易流程和私聊图片
- 任务带 `status`：open → claimed → finished → paid → done，另外还有 cancelled（已撤回）和 closed（管理员关闭）。
- `POST /api/channels/<ch>/messages/<id>/finish`：接单人点「我已完成」。`/paid`：发布人点「我已付款」。`/received`：接单人点「确认收款」，任务变成 done，这时发奖励积分。`/complete`：发布人「无需付款，直接完成」，只允许在 claimed 状态使用。进入 finished 之后不能 kick、撤回或放弃接单。每一步都会在私聊里写一条系统消息（`type:'system'`）。
- `POST /api/admin/tasks/<id>/force {action:'done'|'close', reason, refundPost?, refundClaim?}`：管理员强制完成（发奖励）或关闭任务（按勾选退还积分）。接单人在 finished 或 paid 状态下删号时，标记 `claimerDeleted` 并转入 disputed，由管理员 force 处理。
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
  - 计入信用的评价，同一个评价人只算最新的 1 次；评价双方的 IP 有重叠仍计入，只向管理员提示。
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

## 数据保存、安全边界与回归验证

- 成功的 JSON API 响应返回前，待写数据会写入临时文件、执行 fsync 并替换 data.json。写盘失败返回 503，进程停止接受操作并以非零状态退出，由托管平台重启；排查日志与存储空间后恢复。此策略优先保证余额和交易记录的保存，整库同步写入的耗时需随数据增长监测。
- 新记录使用持久化递增 ID，启动时扫描旧记录的最高 ID；保留旧 ID 和图片路径。账号带不可复用的 id，议价记录绑定该身份；旧记录按账号创建时间迁移，身份不明或已注销的记录仅供发布人和管理员审计。同名新账号不会继承旧议价。
- 放弃接单、发布人取消接单人或接单人在待完成阶段删号后，任务恢复议价前报价；原议价历史保留。管理员参与的任务也能读取所有历史私聊及仍保留的图片。
- 普通 JSON POST 请求先读完请求体再检查权限和状态，最大 100000 字节；非法 JSON 返回 400，超限返回 413。图片使用独立的大小限制，读完上传内容后复核会话、封禁状态和双方身份。
- 静态服务只允许 PUBLIC_FILES 中的明确资源。添加新的公开资源时需要更新白名单；测试、源代码、备份及运维文件不自动公开。.dockerignore 排除运行数据和测试，.gitignore 排除本地数据与审查产物。
- 本地运行回归测试：`node --test tests/regression.test.cjs`。测试启动独立临时数据目录和随机端口，验证账号隔离、慢请求竞态、议价、管理员历史聊天和图片、积分幂等、数据落盘、写盘故障、重启、静态访问与前端逻辑；不访问正式站。前端逻辑测试不替代真实浏览器验收。
- 真实浏览器回归：开发机执行 `npm ci` 后运行 `npm run test:all`。Windows 默认使用已安装的 Edge；其他平台先执行 `npx playwright install chromium`。可通过 BROWSER_CHANNEL 选择其他已安装浏览器。Playwright 仅用于测试，正式站仍直接执行 `node server.js`，不需要安装开发依赖。
- 登录、退出及账号跨标签页变更后会重载当前页面，释放旧账号的私聊、议价和评价缓存；保留当前频道地址。session.js 也会在页面从历史记录恢复或重新可见时检查会话变化。频道已读标记按账号分别保存，损坏的本地标记不会阻止页面启动。
- 频道刷新和后台栏目加载忽略迟到的旧请求，防止新状态被旧响应覆盖。发任务和登录表单提交期间禁用重复提交；合法的两位小数报价不使用浮点精确相等判断。
- `GET /api/admin/overview?summary=1` 只返回未处理数量及存储信息，保留原 overview 全量接口兼容性。后台按当前栏目加载 users、messages、announcements 等列表；查看设置、充值、建议等栏目不再下载全部消息。用户列表的发帖计数直接扫描原消息，避免创建全量消息副本。
- 后台消息按每页 50 条加载，支持首页、上一页、下一页、末页和搜索筛选；没有原先只能显示前 500 条的限制。`GET /api/admin/messages?page=1&limit=50&q=&channel=&filter=` 返回 `{messages,total,page,pageSize,pages}`，limit 为 1–100，filter 可为空或 task、note、live、gone。搜索已删除内容时仍匹配管理员保存的原文；省略 page 和 limit 仍返回旧版全量数组。
- 数据库读取不仅检查 JSON 语法，还检查用户、消息、积分配置和集合结构。主库损坏时保留原文件并跳过无效备份；主库缺失但存在备份、临时数据或上传文件时，不会当作新站点创建空库。真正全新的数据目录仍可正常注册。
- 自动备份先写临时文件、fsync 后再改名。只按有效快照计算每日间隔及 7 份保留数，无效备份保留原件并记录日志；新备份写入失败时不删旧快照。下载备份可以恢复账号、任务、私聊文字和积分，不恢复原登录令牌，也不包含上传图片文件；恢复时需要另外保留 uploads 目录。
- 图片删除失败时保留元数据、记录待重试状态并继续计入存储占用，启动和每小时清理时重试。前端私聊关闭后释放图片 object URL，迟到的图片不会再创建无主地址；后台同时取消尚未完成的图片读取。
- 密码计算同时最多 2 个、等待最多 8 个；过载返回 503，可稍后重试。登录失败额度计入正在校验的请求，避免并发绕过同账号同 IP 的 10 次限制。频率计数的时间戳和键数有上限，每分钟清理过期项；达到容量时拒绝新请求，不遗忘已有锁定。
- 任务状态操作每人每分钟最多 60 次。私聊历史达到 2000 条后不再允许新接单或议价成交；当前订单仍可完成、申请介入、撤回或由管理员处理。没有到期时间的旧版登录在升级时失效，需要重新登录；有正常到期时间的会话迁移绑定账号 id，账号身份不匹配或达到到期时间时立即拒绝。
- 数据落盘按集合中的记录分块编码，仍保留临时文件、fsync、改名和成功响应前落盘规则；已覆盖短写、写到一半失败、中文/表情与嵌套 JSON 的恢复测试。任务列表先筛选、排序、取所需条数，再添加个人状态；至多 7 份备份且存在当日有效快照时，备份检查不重复解析其他快照。
- 开发机基准：`npm run bench`，可用 `npm run bench -- --backup-due` 测量需要生成当日备份的场景。基准使用临时数据和本机回环地址，不访问正式站；本机 RSS、延迟不代表 Sealos 128MB / 0.1 核容器的容量保证。数据继续增长时仍需评估资源或存储方案。`BIND_HOST` 可设绑定地址，默认 0.0.0.0；测试与基准固定绑定 127.0.0.1。
