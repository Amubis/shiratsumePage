# Cloudflare 后台、图片存储与部署配置

这份指南把网站静态文件、管理 API 和图片存储部署到同一个 Cloudflare Worker，并用 D1 保存评论。网站仍可保留在 GitHub Pages，通过公开 API 读取已经发布的内容；管理页则始终在 Worker 的 `/admin/` 地址登录。

下列步骤需要你自己的 Cloudflare 账号和已开通的 R2；绑定自有域名时还需要该域名的管理权限。示例中的域名、账号名和桶名请换成自己的值。下方的 GitHub Actions 快速入口可以代建私人桶、D1 并部署，无需本地安装或预览；账号、R2 订阅与一次性的 workers.dev 子域激活仍在你的 Cloudflare 控制台完成。

首次配置可以先使用 Cloudflare 提供的 `workers.dev` 地址，无需续费域名。各部分的用途如下：

| 服务 | 保存的内容 |
| --- | --- |
| GitHub | 源代码、初始公开内容、GitHub Pages 静态构建 |
| Worker | 网站文件、登录、内容发布、上传与评论 API |
| 私人 R2 桶 | 图片、私有原图、内容草稿与已发布内容 |
| D1 数据库 | 匿名留言、审核状态、管理员回复、未读状态 |

## 快速入口：把部署交给 GitHub Actions

适合已经开通 R2、希望直接使用线上管理页的情况。本流程不需要 R2 Access Key、Secret Access Key、Cloudflare 全局 API Key，也不用先购买域名。

1. 在 Cloudflare **Workers & Pages** 确认账号已经启用一个 `你的子域.workers.dev` 地址；如果是第一次使用 Workers，按控制台提示选择一次。自动脚本只读取它，不会替你修改账号级子域。
2. 这个仓库的运行表单已预填你提供的公开 **Account ID `1625a67d00c90d31ecaa89f00063e83d`** 和已有私人 **R2 桶 `shiratsume-page`**，无需重复填写。两项都是公开配置；换账号或桶时才调整表单。指定桶尚不存在时，部署会创建一个 Standard 私人桶。
3. 打开 Cloudflare **My Profile → API Tokens → Create Token → Create Custom Token**。此快速入口使用个人资料页的兼容权限令牌；只选择以下账号权限，并将 **Account Resources** 限定为自己的目标账号：

   | 权限类别 | 项目 | 级别 |
   | --- | --- | --- |
   | Account | Workers Scripts | Edit |
   | Account | Workers R2 Storage | Edit |
   | Account | D1 | Edit |

   `Workers Scripts` 在新界面可能标为“旧”或 `Legacy`，本流程仍选择它的 **Edit**。Cloudflare 说明此权限目前继续有效，尚无停用日期；此处无需改成新账号级令牌或额外申请 Admin 权限。[官方兼容权限说明](https://developers.cloudflare.com/workers/authorization/workers/#legacy-workers-permissions)。

   官方 API 权限名也可能显示为 `Workers Scripts Write`、`Workers R2 Storage Write` 和 `D1 Write`，含义对应以上三个写权限。不需要 Zone、DNS、KV 或 Billing 权限。[官方权限表](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)、[R2 创建权限](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)、[D1 创建权限](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/)。

4. 打开仓库 [Settings → Secrets and variables → Actions](https://github.com/Amubis/shiratsumePage/settings/secrets/actions)，在 **Secrets** 添加两项：

   | Secret 名称 | 内容 |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | 上一步刚创建的令牌 |
   | `ADMIN_PASSWORD` | 你为线上内容管理设置的独立密码 |

   **不要在对话里发送令牌或密码，也不要把它们写进仓库文件。** 无需手动生成会话密钥：首次部署会生成随机 `SESSION_SECRET`，直接存入 Worker Secret；后续运行保留已有值。密码通过 JSON 标准输入传给 Wrangler，不写入配置文件或命令参数，也不输出到日志。

5. 到仓库 **Actions → Cloudflare content management → Run workflow**，选择 `main`，确认预填的 Account ID 和私人 R2 桶名，运行即可。同一页面的 **Variables** 也可设置 `CLOUDFLARE_ACCOUNT_ID`，之后在运行表单清空 Account ID 时使用该变量。这个工作流只有手动触发，不会因普通页面修改自动创建云端资源；同一时间只运行一个生产部署。

运行会依次检查输入、测试和构建网站、确认 R2 没有公共域名、按名称复用或创建 D1、执行尚未应用的迁移、部署网站及 `/admin/`、设置管理员密码并检查登录服务就绪。随后 Runner 会用 Secrets 做一次真实登录与登录会话检查，再尝试退出并丢弃临时 Cookie；不读取私有草稿，密码、Cookie 和 CSRF 凭证均不输出到日志。已有桶和数据库不会被删除，已有草稿、发布内容、图片、评论不会用仓库初始数据覆盖；首次内容仍由现有的条件写入逻辑初始化。若桶开启了 `r2.dev` 或公共自定义域名，会停止并提示你关闭或换桶，不自动改变其访问规则。

成功后，Actions 的 **Summary** 会显示网站和管理地址，例如 `https://shiratsume-page.你的子域.workers.dev/admin/`。默认账号为 **Amubis**，密码为上面设置的 `ADMIN_PASSWORD`。需要其他公开名称时，可在 Actions **Variables** 设置 `CLOUDFLARE_WORKER_NAME`（默认 `shiratsume-page`）、`CLOUDFLARE_D1_NAME`（默认 `shiratsume-comments`）、`ADMIN_USERNAME`（默认 `Amubis`）。`PUBLIC_SITE_ORIGINS` 默认允许 `https://amubis.github.io` 提交访客评论；增加域名时填逗号分隔的 HTTPS origin。

**连接现有 GitHub Pages：** 云端成功后，将返回的 Worker 根地址填到 `data/runtime.json` 的 `apiBaseUrl`，其 `/admin/` 填到 `adminUrl`，提交后让 Pages 正常部署。管理页由 Worker 同源提供，GitHub Pages 则读取这个中央 API；之后换个人域名时更新中央连接地址即可，保留原来的 Worker/R2/D1 就不需要重新上传图片或逐张修改链接。这个手动工作流不会自行修改仓库内容。

工作流使用固定 Wrangler 4 版本，配置临时生成在 `worker/` 并自动清除；原有 `worker/wrangler.jsonc` 保留给手动部署使用。所有必要参数未设置之前不能执行真实部署。若失败，根据日志的权限或资源提示修正后重新运行，正常重跑会复用已有云端资源。

## 1. 可选：在本地预览

安装 Node.js 22 或更新版本，在项目根目录打开终端：

```bash
npm install
npm run admin
```

打开终端显示的管理地址，默认是 `http://127.0.0.1:4310/admin/`；网站预览地址是 `http://127.0.0.1:4310/`。保持终端运行，结束时按 `Ctrl+C`。如端口已占用，可使用 `GARDEN_PORT=4311 npm run admin`。

本地服务只监听本机回环地址，本地管理不要求云端管理员密码。不要把这个本地服务代理到公网。直接双击 HTML、使用普通静态文件服务器，或者只运行 `npm run dev`，都不能代替有管理 API 的本地服务。

推荐先完成一次完整操作：修改一条文案 → 上传一张测试图 → 保存草稿 → 打开预览 → 发布到网站。这里的“发布”只更新本地数据，不会改动线上网站。

- `data/garden.json` 是首次启动的初始内容；已有持久化数据时，重新启动不会用初始内容覆盖它。
- 本地草稿、已发布版本、上传的展示图和私有原图保存在 `.garden-data/`。
- “保存草稿”与“发布到网站”是两个动作。公开网站只读取已发布版本。
- 管理页可以导出 JSON 备份；JSON 不包含图片文件。本地与云端使用各自的存储，本地上传的文件不会自动进入 R2。

## 2. 在自己的账号开通 R2，并创建私人桶

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 打开 **Storage & databases → R2 → Overview**。如果尚未开通，按照页面完成 R2 订阅与 checkout；是否需要填写付款方式以账号当前页面为准。
3. 创建一个桶，例如 `shiratsume-garden-private`，使用 **Standard** 存储类型。
4. 保持桶私有：不要启用 `r2.dev` 公共访问，也不要给整个桶绑定公共自定义域名。

本项目通过 Worker 的 `/media/` 路由提供可公开的展示图；原图保存在 `private/originals/`，需要管理员登录才能下载。不要因为需要展示照片而公开整个 R2 桶。

截至核查时，R2 **Standard** 每月免费额度包含 10 GB-month 存储、100 万次 Class A 操作和 1000 万次 Class B 操作。10 GB-month 是月度存储用量，原图、展示图、缩略图等都占容量。超出免费额度后，Standard 按 $0.015/GB-month、$4.50/百万次 Class A、$0.36/百万次 Class B 计费；Infrequent Access 不适用这些免费额度。

R2 直接通过 Workers API 等方式向互联网传出数据不收取 egress 出网费，但存储、操作、Workers 或其他相接服务仍可能收费。免费额度不是消费硬上限，也不代表整个网站永久免费。请在控制台查看用量与账单，实际价格以 [R2 Pricing](https://developers.cloudflare.com/r2/pricing/) 为准。

官方说明：[R2 开通步骤](https://developers.cloudflare.com/r2/get-started/)、[创建桶及访问方式](https://developers.cloudflare.com/r2/buckets/create-buckets/)。

## 3. 检查 Worker 的静态文件与 R2 绑定

项目配置文件是 `worker/wrangler.jsonc`，关键部分如下：

```jsonc
{
  "name": "shiratsume-garden",
  "main": "index.mjs",
  "assets": {
    "directory": "../dist",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*", "/media/*"]
  },
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "shiratsume-garden-private"
    }
  ]
}
```

这是关键字段示例；保留仓库配置中的 `$schema`、`compatibility_date` 和其他已配置字段。只需把 `bucket_name` 改成实际创建的桶名；如要自定义 Worker 名称，可修改 `name`。

`ASSETS` 和 `BUCKET` 是代码读取的绑定名，必须保持完全一致。`ASSETS` 提供构建后的 `dist/` 静态文件；`BUCKET` 提供私人 R2 访问；`run_worker_first` 确保 API 与媒体请求先经过 Worker。不要把 `dist/` 路径误写成相对于项目根目录的 `./dist`：这里的路径相对于 `worker/wrangler.jsonc`。

Worker 通过绑定访问 R2，不需要把 R2 S3 Access Key 放进浏览器。普通上传和内容管理也不要求创建公开桶。

官方说明：[Static Assets 绑定](https://developers.cloudflare.com/workers/static-assets/binding/)、[Workers 使用 R2](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)。

## 4. 构建、登录，并配置服务端 Secrets

先在项目根目录完成检查：

```bash
npm run test
npm run build
npm run cloud:login
```

登录命令会打开浏览器，请登录拥有上述 R2 桶的账号。若账号下有多个 Cloudflare account，确认选中实际创建桶的 account。以下命令均从项目根目录运行，并使用 Wrangler 4。

接下来的命令会操作真实云端 Worker。先确认 `name` 和 `bucket_name` 正确，再按提示交互输入：

```bash
npx wrangler@4 secret put ADMIN_PASSWORD --config worker/wrangler.jsonc
npx wrangler@4 secret put SESSION_SECRET --config worker/wrangler.jsonc
npm run cloud:deploy
```

- `ADMIN_PASSWORD`：仅用于你登录管理页的独立强密码。
- `SESSION_SECRET`：至少 32 个随机字符，用于签名登录会话；不要与管理员密码相同。

管理页目前采用一个管理员账号，默认账号为 **`Amubis`**，配合上面的 `ADMIN_PASSWORD` 登录；不提供访客注册或多人账号管理。账号会去掉前后空格，大小写不敏感。需要更换账号名时，在 Worker 的 **Settings → Variables and Secrets → Add** 中添加名为 `ADMIN_USERNAME` 的 **Text** 变量，填写自己的账号名并部署生效。账号名最多 120 个字符；它不是秘密，密码和会话密钥仍必须使用 Secret 类型。修改账号、密码或会话密钥后，已有登录会话均需要重新认证。

如果希望账号配置随源码部署保持一致，也可以在 `worker/wrangler.jsonc` 中添加同级的 `vars` 字段，例如 `"vars": { "ADMIN_USERNAME": "Amubis" }`，以后从源码部署时保留自己的值。不要把 `ADMIN_PASSWORD` 或 `SESSION_SECRET` 放进 `vars`。

可以在本机用下面的命令生成随机会话密钥，然后把结果粘贴到 `SESSION_SECRET` 的交互输入框，保存在自己的密码管理器中：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

两项都必须是 **Worker 服务端 Secret**。不要写进 `runtime.json`、`data/garden.json`、`wrangler.jsonc`、前端代码或 Git 仓库，也不要把它们作为网页“连接地址”填写。也可以在控制台 Worker 的 **Settings → Variables and Secrets** 中以 **Secret** 类型添加。

注意：Cloudflare 当前的 `wrangler secret put` 会创建新版本并立即部署，因此上述配置已经属于上线操作。若这是已有 Worker，变更前先确认目标；更换 `SESSION_SECRET` 后，已有管理员会话需要重新登录。仅修改后端 Secret 不需要修改公开内容配置。

如果第一次设置 Secret 时 Wrangler 提示创建同名 Worker，确认目标名称后按提示处理；完成两项 Secret 后，再执行最后的 `npm run cloud:deploy`，以便重新构建并发布当前网站文件与绑定配置。后续仅更改文案或上传照片，使用管理页保存与发布即可，无需每次重新部署代码。需要启用评论时，继续完成第 7 节的 D1 配置并再次部署。

官方说明：[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Wrangler 登录](https://developers.cloudflare.com/workers/wrangler/commands/general/)、[Wrangler 部署](https://developers.cloudflare.com/workers/wrangler/commands/workers/)。

## 5. 连接公开网站与管理后台

部署后，Wrangler 会显示 Worker 的 HTTPS 地址，例如 `https://shiratsume-garden.YOUR-SUBDOMAIN.workers.dev`。

先打开这个地址的 `/admin/`，输入管理员账号（默认 `Amubis`）和 `ADMIN_PASSWORD` 登录。再打开 `/api/content`，确认可以读取已发布内容。浏览器登录 Cookie 属于这个 Worker 的域名；管理页应直接使用 Worker 自己的地址。

账号密码由 Worker 后端验证，并由它保护草稿、上传、发布和评论审核接口。GitHub Pages 只能提供静态管理界面，前端增加一个密码框不能保护后台数据。本地 `npm run admin` 仍仅监听本机回环地址并自动认证，不要求输入云端账号密码。

云端管理未登录、会话失效或断网时，草稿、消息和内嵌预览会锁住，不会降级为可打开私有备份的静态编辑模式。重新认证后可继续处理当前页面内保留的未保存编辑。点击退出登录会清除当前浏览器的草稿备份、预览与私有内容；有未保存内容时可以取消退出，先保存到服务端或导出。正在保存、发布或导入图片时，请等操作完成再退出。服务端已保存的草稿和上传文件不会因退出而删除。

### 网站也放在这个 Worker

直接使用 Worker 的首页地址，或者为 Worker 绑定自己的站点域名。公开网页、管理页、API 与 `/media/` 都由同一源提供。`data/runtime.json` 的 `apiBaseUrl` 与 `adminUrl` 可以保持空字符串，前台会使用同源 API。

### 网站继续使用 GitHub Pages

将 `data/runtime.json` 改为以下格式，再提交 GitHub 并等待原有 Pages 工作流完成。示例中的 Worker 子域名需要替换为实际值：

```json
{
  "schemaVersion": 1,
  "apiBaseUrl": "https://shiratsume-garden.YOUR-SUBDOMAIN.workers.dev/",
  "adminUrl": "https://shiratsume-garden.YOUR-SUBDOMAIN.workers.dev/admin/"
}
```

`apiBaseUrl` 填 Worker 根地址，不追加 `/api/content`；`adminUrl` 填完整管理页地址。运行配置是公开文件，只放这类公开连接信息。

后台依然从 Worker 的 `/admin/` 进入。GitHub Pages 只负责静态文件，本身不能执行 Worker 管理 API；仅把 `/admin/` HTML 上传到 GitHub Pages，并不代表上传、保存和发布已连接云端。

管理页“连接与备份”的“公开网站地址”应填实际入口，例如 `https://amubis.github.io/shiratsumePage/`，然后保存并发布。评论服务会从这个地址提取来源 `https://amubis.github.io`，允许该网站提交匿名留言。公开内容读取不依赖管理员 Cookie；上传、保存和审核仍在 Worker 同源管理页完成。

使用管理页保存并发布一次小改动，然后从公开网站刷新确认。草稿预览成功并不能代替这个公开发布检查。

## 6. 图片上传、公开版本与备份

从管理页上传图片，服务端会把文件存进私人桶。公开展示图与缩略图使用稳定的 `media/<内容哈希>.<扩展名>` 对象键；私有原图使用单独的 `private/originals/` 对象键。公开内容接口不包含管理员原图下载入口。

相册照片需勾选发布，碎碎念需勾选发布；然后先“保存草稿”，再“发布到网站”。只上传图片或者只保存草稿，都不会把相应内容直接放到公开页面。

删除内容目前只移除引用，不会清理桶中的文件；未引用的图仍占存储空间。JSON 导出只包含内容及图片引用，不能代替 R2 文件备份。保留自己的原始照片，迁移前同时备份内容 JSON 和所需对象。

从本地转到云端时，可以导出、导入 JSON 内容，但 `.garden-data/` 中的图片不会随 JSON 上传。需要在云端重新上传对应图片，或使用实际的对象迁移流程，并确认引用仍能解析。

## 7. 评论、D1 与站内消息中心

评论与通知使用独立 D1 数据库，图片与内容草稿继续存储在 R2。未绑定 D1 时公开页面会显示评论暂未开放，内容管理和图片功能仍可使用。

在项目根目录执行：

```bash
npx wrangler@4 d1 create shiratsume-garden-comments --config worker/wrangler.jsonc
```

这一步会创建真实云端数据库。也可以在控制台 **Storage & databases → D1 → Create database** 创建同名库，然后从数据库详情页复制 UUID；两种创建方式选择一种即可。

将命令返回的实际 `database_id` 加入 `worker/wrangler.jsonc`，保留已有的静态资源与 R2 绑定。`d1_databases` 与 `r2_buckets` 是同级字段，注意在前一个字段结尾加逗号：

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "shiratsume-garden-comments",
  "database_id": "替换为实际数据库 ID",
  "migrations_dir": "migrations"
}]
```

初始化线上数据库，再重新部署 Worker：

```bash
npx wrangler@4 d1 migrations apply DB --config worker/wrangler.jsonc --remote
npm run cloud:deploy
```

`database_id` 是公开资源标识，可以保存在配置中；它不是登录密码。`migrations_dir` 相对于配置文件，指向 `worker/migrations/`，现有迁移为 `0001_comments.sql`。线上初始化必须保留 `--remote`，否则操作的是本地模拟数据库。

部署后，可在控制台 **Workers & Pages → shiratsume-garden → Settings → Bindings** 核对 `BUCKET` 和 `DB` 是否绑定到正确资源。没有绑定 `DB` 时，评论接口返回 `503` 与 `available:false`；已经绑定但没有应用迁移时，评论查询也无法正常工作。

如果需要单独验证 Worker 的本地模拟，先用 `--local` 代替 `--remote` 应用迁移，再构建网站并运行 `npm run cloud:dev`；本地模拟登录所需的 Secrets 放在 `worker/.dev.vars`，不要提交 Git。日常本地编辑直接用 `npm run admin` 即可，它自动使用 `.garden-data/` 的本地评论文件，不需要 D1 或云端登录。

所有访客留言都先进入待审核状态，公开页面只返回已批准的留言。昵称选填，无需注册；留言只关联已经公开的照片或碎碎念。照片播放器右侧显示该照片的留言，碎碎念下方可展开对应留言。登录后台的「消息中心」可查看上下文，批准、拒绝、标为垃圾、删除、标记已读，并在批准后发送管理员回复。管理员回复由服务端标记身份，浏览器不能自行声明为管理员。

导航显示待审核和未读数量；管理页面可见时每 30 秒轻量刷新，窗口重新获得焦点时刷新，后台标签页暂停轮询。通知只在登录的管理端展示，不使用邮件或第三方消息推送。提交测试留言后，确认「待审核 → 消息中心出现未读 → 批准 → 公开页面显示 → 管理员回复 → 标为已读」的完整流程。

网站与 Worker 不同源时，评论提交允许已发布内容中“公开网站地址”的来源。若还需要额外允许预览站点，可以在 Worker **Settings → Variables and Secrets** 添加普通变量 `PUBLIC_SITE_ORIGINS`，填写逗号分隔的来源，例如 `https://amubis.github.io,https://garden.example.com`。来源只包含协议与域名，不带路径。管理 API 仍仅接受同源登录会话与 CSRF 校验；管理密码不写入公开运行配置。

D1 迁移后请自行定期备份评论数据库；内容 JSON 导出不包含评论。仅更换网站域名、保留原数据库时，留言、审核与未读状态会保留。官方文档：[D1 创建与查询](https://developers.cloudflare.com/d1/get-started/)、[D1 命令](https://developers.cloudflare.com/d1/wrangler-commands/)、[D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/)。

## 8. 更换网站域名，无需逐张改图片

后台上传的图片保存的是稳定对象键，网站展示时再与媒体服务基础地址组合。只更换网站域名、保留原 Worker 和 R2 时，不需要逐张替换图片链接或重新上传。

如果连 Worker 的访问域名也更换：

1. 在 Cloudflare 为同一个 Worker 绑定新域名，并确认 HTTPS、`/api/content`、`/media/` 和 `/admin/` 正常。
2. 网站与 Worker 不同源时，把公开 `data/runtime.json` 的 `apiBaseUrl`、`adminUrl` 更新为新 Worker 地址，并重新发布静态网站。
3. 管理页“连接与备份”中如曾固定填写媒体基础地址，改成新地址；若设置了 Worker 的 `MEDIA_BASE_URL`，同步更新这个服务端配置。不要同时留下互相矛盾的旧地址。
4. 把“公开网站地址”改为新站点入口；如配置过 `PUBLIC_SITE_ORIGINS`，同步调整允许的来源。
5. 保存、发布并用公开网站检查一张旧图、一张新上传图片和留言提交。新域名下重新登录后台；Cookie 不会跨域迁移。

`MEDIA_BASE_URL` 应是实际能处理 `/media/` 的 HTTPS 源地址，例如 `https://garden.example.com`，不要再追加 `/media`。同源使用且未固定旧地址时，可以让服务端使用当前请求的域名。

上述便利适用于后台保存的 `media/…` 对象键。手动填写的外部绝对 URL 仍由原图片服务负责；关闭旧外部服务前，需要另外迁移这些资源。若更换的是 R2 桶或账号，需要复制对象并更新绑定；只改网站域名并不能搬动数据。

## 常见情况

| 看到的现象 | 检查位置 |
| --- | --- |
| “仅浏览器草稿”或“管理 API 未连接” | 是否从真实 Worker 或 `npm run admin` 的 `/admin/` 进入；当前源的 `/api/admin/session` 是否返回 JSON。 |
| 提示 `BUCKET` 未绑定 | `worker/wrangler.jsonc` 的绑定名与实际桶名，及当前 Cloudflare account。 |
| 提示云端认证未配置 | `ADMIN_PASSWORD` 是否存在，`SESSION_SECRET` 是否至少 32 个字符，且两项均为当前 Worker 的 Secret。 |
| 图片 404 | 上传是否成功、对象是否在对应环境的桶里、媒体基础地址是否仍指向旧域名。 |
| 已保存但公开网站未变 | 是否点击“发布到网站”、照片或碎碎念是否勾选发布、公开运行配置是否指向同一个 Worker。 |
| 保存遇到版本冲突 | 先导出当前编辑，再重新载入服务端草稿并合并；不要用旧窗口覆盖新内容。 |
| 评论暂未开放 | Worker 是否绑定 `DB`；数据库是否已经执行远端迁移。 |
| GitHub 网页可以读内容，却无法提交评论 | 已发布内容的“公开网站地址”和 Worker 的 `PUBLIC_SITE_ORIGINS` 是否允许 `https://amubis.github.io`。 |
| 后台没有新留言通知 | 确认匿名提交成功、使用同一个 Worker 与 D1，并在可见的消息中心手动刷新；当前没有外部推送。 |

官方文档核查日期：2026-11-15。Cloudflare 控制台名称、免费额度与价格可能调整，请以上述官方页面及账号实际界面为准。
