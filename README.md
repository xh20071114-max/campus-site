# Aevon校园交流网

校园互助网站：门户首页、注册登录、四个项目频道（校园跑、食堂配送、代取快递、代课），频道内可发任务、接单、完成，个人中心查看我发布的和我接的任务。

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
