# Orca Discord Presence

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文**

将你的 [Orca](https://github.com/stablyai/orca) 智能体集群正在做的事情，显示在你的 Discord 状态中，旁边配有 Orca 的 logo。

```text
┌──────┐  Orca                                                    ← minimal (default)
│ logo │  2 agents working · 1 blocked · across 2 worktrees   (3 of 5)
└──────┘  12:40 elapsed

┌──────┐  Orca · checkout-service · feat/ipc                      ← full
│ logo │  2 agents working · 1 wrapping up · in checkout-service, web   (3 of 5)
└──────┘  12:40 elapsed
```

第一行是**标题行（header）**，内容由你决定。第二行是[集群状态行](#集群状态行)，末尾是 Discord 自带的队伍计数：忙碌的智能体数 / Orca 已上报的智能体数。计时器衡量的是[当前这一段工作](#已用时间计时器)持续了多久，而不是 Orca 打开了多久。

使用 TypeScript 编写，没有运行时依赖——直接通过 `node:net` 使用 Discord Rich Presence 的 IPC 协议通信。

## 运行要求

- Orca `>= 1.4.0`，并已启用插件系统（Settings → Plugins）——最近一次针对 Orca `1.4.230` 验证，参见[兼容性](#兼容性)
- 在同一台机器上运行 Discord **桌面**客户端（网页版不提供本地 IPC 套接字）

除此之外不需要任何东西。插件自带一个 Discord 应用 id，只要有智能体开始工作就会立即发布状态。

## 安装

Settings → Plugins → *Add marketplace*，粘贴下面的 URL，然后接受授权对话框：

```text
https://github.com/LuticaCANARD/orca-discord-presence.git#v0.3.1
```

`#v0.3.1` 这一部分很重要：没有它，Orca 会从不断变化的 `main` 分支读取索引。对话框中会列出下文的[所请求的权限](#所请求的权限)。如果你想修改插件本身，请参见[开发](#开发)。

## 会发布哪些内容

本节内容均不可配置；它说明的是卡片上显示什么，以及为什么这样显示。

### 集群状态行

当智能体处于 `working`、`blocked` 或 `waiting` 状态时，视为忙碌。Orca 对后两者的显示完全相同——"智能体需要用户关注"——因此一个停在权限确认提示上的集群会让计时器继续运行，而不是显示为空闲；并且两者各自占一个分段，因为"卡住了"和"在询问你"是不同的消息。

`working` 是 Orca 的**合并**状态，这个词背后藏着一些东西：只要主智能体*或任何仍在运行的子智能体*在工作，窗格就会显示 `working`，所以主智能体已经结束、但子智能体还在运行的窗格仍会被计入。宿主现在会在合并状态之外，另行上报主智能体自身的状态，因此这些窗格会被单独拆出来显示为 `1 wrapping up`，并从 working 计数中扣除——三个 working 窗格中有一个只是子智能体的收尾，会显示为 `2 agents working · 1 wrapping up`，而不会算成四个智能体。如果宿主不发送主智能体的信息，就无从判断，它的窗格仍按普通的工作中智能体计算。

*以失败告终*的回合被刻意排除在外。宿主会上报主智能体最近一次完成的回合的结果（`failure`、经确认的 `interruption`、由某人主动发起的 `cancellation`），但公开个人资料上的失败计数，在它不再是新消息的几分钟后就只是噪音。**Show Connection Status**（显示连接状态）会在可以采取行动的地方报告最近的失败。

### 已用时间计时器

计时器从集群当前这一段工作开始的时刻计起。这个时刻有两种答案，而宿主给出的那个更好：`mainAgent.stateStartedAt` 是在智能体自身状态开始时打上的时间戳，而本插件只能知道自己*注意到*的时刻。两者的差别恰好出现在值得关注的情况下——Orca 会在插件工作进程空闲五分钟后将其回收，并在下一个事件到来时重新启动；插件也可能在智能体已经运行时才被启用。宿主的时间戳在这两种情况下都能保留下来，而本地观察到的时间戳会让时钟从零重新开始。

因此，以仍在忙碌的智能体中最早的那个自身时间戳为准，本地观察值作为后备。仅处于收尾阶段的窗格不参与确定起点——它们的时间戳记录的是主智能体进入 `done` 的时刻，而不是子智能体正在收尾的那项工作的开始。时间戳来自智能体运行所在的机器，对于 SSH 主机来说那并不是本机，所以比本机快一分钟以上或早于一天以上的值会被丢弃，而不会被发布成一个从未来倒数的计时器。**Show Connection Status** 会说明计时器当前使用的是两者中的哪一个。

### 队伍计数

Discord 会在状态行旁显示 `(3 of 5)`：忙碌的智能体数 / Orca 已上报过状态的窗格数。它不包含任何名称，因此在 `full` 和 `minimal` 下都会发布；当没有任何智能体忙碌时则不显示——`(0 of 5)` 看起来像是坏掉的队伍，而不是空闲的集群。随之一起发送的队伍 id 在每个工作进程中随机生成，且无法加入：Rich Presence 需要 join secret 才会在你的个人资料上显示 **Join** 按钮，而本插件从不发送它。

## 隐私

**默认级别是 `minimal`，这是有意为之。** 分支名中经常包含工单编号和客户名称，如果一启用插件就把它们发布出去，那将是一个糟糕的默认值。

| 级别 | 发布的内容 |
| --- | --- |
| `full` | 标题行、当前聚焦的工作区、分支、智能体计数，以及智能体正在工作的工作区 |
| `minimal` *（默认）* | 标题行和智能体计数。忙碌的 worktree 只计数，从不显示名称；标题行中的 `{workspace}` 和 `{branch}` 会被置空 |
| `off` | 不发布任何内容；状态会被清除 |

使用 **Cycle Privacy Level**（切换隐私级别）命令在各级别间切换。`minimal` 的遮蔽并不只是约定——测试会断言在该级别下，任何项目、分支或工作区名称都不会进入发送的数据。

工作区名称取自 worktree 的目录名，没有时退回到其分支名。只有在插件运行期间由 Orca 通告过的 worktree 才能显示名称，因此 `full` 状态在无法显示名称时会退化为 `across 2 worktrees`，而不是留空；较长的列表会被折叠为 `in api, cli, docs +2`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `Discord Presence: Toggle` | 启用/禁用发布 |
| `Discord Presence: Cycle Privacy Level` | 有参数时将级别设为该参数；没有参数时按 `full` → `minimal` → `off` → … 循环切换 |
| `Discord Presence: Set Header` | 有参数时将第一行设为该参数；没有参数时循环切换预设 |
| `Discord Presence: Reconnect` | 断开与 Discord 的连接并立即重新发布 |
| `Discord Presence: Show Connection Status` | 显示正在发布的内容、logo 和徽章的 key、最近以失败告终的回合、连接状态、套接字路径以及最近一次错误 |

所有命令的结果都会被持久保存。出现问题时，首先应该使用 **Show Connection Status**——它会报告上一次发布失败的原因。

**Reconnect**（重新连接）用于退避重试无法覆盖的情况：Discord 在 Orca 之后才启动，或在集群空闲期间重启过。插件会自行重试，但只限于其工作进程存活期间，而 Orca 会在工作进程空闲五分钟后将其回收（参见[已知限制](#已知限制)）。执行该命令会重新启动工作进程，*并*让新进程立即连接。

### 快捷键

每个命令都会出现在 **Settings → Shortcuts → Plugins** 中，你可以为常用的命令录制组合键——最可能用到的是 `Toggle` 和 `Cycle Privacy Level`。

**插件刻意不提供默认组合键。** 对 Orca 来说，清单中的快捷键绑定属于*指示性内容*：声明一个绑定会把你的授权同插件的文件树绑定在一起，于是每次发布新版本都会在 Settings → Plugins 中显示为 *Needs review*；而与其他插件冲突的组合键会让**两个**插件的命令都被禁用。你自己录制的快捷键属于覆盖设置——它在更新后依然保留，也不会带来上述任何代价。

## 配置

每个设置都有可用的默认值；本节用于修改它们。

### 标题行

**Set Header**（设置标题行）命令是无需文本编辑器的修改方式：

- **带参数时**——参数直接成为标题行，因此快捷键绑定或自动化可以直接设置它：`"My Fleet"` 或 `{ "header": "My Fleet" }`。空字符串会隐藏标题行。
- **不带参数时**——循环切换预设，这也是命令面板单独能做到的全部：

  `Orca` → `{workspace}` → `{workspace} · {branch}` → *隐藏* → `Orca` → …

`{workspace}` 和 `{branch}` 在发布时才解析，而不是固化在设置中，这一区别正是关键所在。标题行设为 `checkout-service` 时，即使降到 `minimal` 也会继续发布这个名称；而 `{workspace}` 会被置空并退回到 `Orca`。解析为空的占位符会连同它的分隔符一起去掉，因此这一行末尾不会残留多余的中点。

### Logo 与徽章

`largeImage` 是一个**美术资源 key**，而不是文件路径——Discord 显示的是上传到发布状态所用应用中的图片。插件自带的应用以 `orca` 为 key 托管了 Orca 的 logo，所以 logo 无需任何配置。

如果把 `clientId` 指向你自己的应用，情况就不同了：在你上传同名图片之前，`orca` 这个 key 在那里没有任何意义。请以 `orca` 为名上传一个 logo，或者把 `largeImage` 设为你所使用的 key。

`smallImage` 是 logo 角落的徽章，**默认关闭**——自带的应用只在 `orca` 这个 key 下托管了图片，设置默认值只会发布一个空白方块。将徽章上传到你自己的应用并填入其 key 即可启用；没有 logo 作为底图的徽章会被丢弃，而不会单独发布。

### 通过你自己的 Discord 应用发布

标题行*上方*那一行显示为 *"Playing \<应用名称\>"*，这个名称属于 Discord 应用，而不属于本插件——Rich Presence IPC 中没有对应的字段。这正是 `header` 存在的原因：它是插件所能控制的最上面一行。如果想修改 *"Playing …"* 这一行本身，请通过你自己的应用发布：

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. 按你希望状态显示的名称为它命名
3. 从 *General Information* 复制 **Application ID**，填入 `clientId`
4. 在 *Rich Presence → Art Assets* 中上传图片，然后把 `largeImage` 设为对应的 key

Rich Presence 应用 id 是公开标识符——它出现在每个客户端的 IPC 通信中，本身不授予任何权限。敏感的是 OAuth client secret，而 Rich Presence 从不需要它，本插件也从不索取。这就是源代码中附带应用 id 的原因。

### 设置文件

Orca 目前还没有按插件区分的设置界面，因此命令覆盖不到的设置需要手动编写：

| 平台 | 路径 |
| --- | --- |
| Linux | `~/.config/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| macOS | `~/Library/Application Support/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| Windows | `%APPDATA%\Orca\plugins-data\lutica-canard.discord-presence\settings.json` |

```json
{
  "enabled": true,
  "privacy": "minimal",
  "clientId": "1234567890123456789",
  "header": "Orca",
  "largeImage": "orca",
  "largeText": "Orca",
  "smallImage": "",
  "smallText": ""
}
```

| Key | 默认值 | 作用 |
| --- | --- | --- |
| `enabled` | `true` | 是否发布 |
| `privacy` | `"minimal"` | 参见[隐私](#隐私) |
| `clientId` | 自带的 id | 用于发布的 Discord 应用 |
| `header` | `"Orca"` | 第一行；支持 `{workspace}` 和 `{branch}`；`""` 表示隐藏 |
| `largeImage` | `"orca"` | logo 的美术资源 key；`""` 表示不发布图片 |
| `largeText` | `"Orca"` | 鼠标悬停在 logo 上时的提示文字 |
| `smallImage` | `""` *（关闭）* | logo 角落徽章的美术资源 key |
| `smallText` | `""` | 鼠标悬停在徽章上时的提示文字 |

所有 key 都是可选的，`""` 表示*关闭*而非*默认值*。重启 Orca，或禁用后重新启用插件，以加载该文件。

## 所请求的权限

| 权限 | 原因 |
| --- | --- |
| `workspace:read` | 读取当前聚焦的工作区名称和分支，用于 `full` 隐私级别 |
| `events:subscribe` | worktree 生命周期和智能体状态变化——即要发布的数据 |
| `storage` | 让集群状态在工作进程被回收后得以保留（见下文） |
| `settings:own` | 插件自身的 `enabled` / `privacy` / `clientId` / `header` / 美术资源 key |
| `notifications:show` | 命令的反馈 |

`secrets` 和 `terminal:send` 被刻意**不**申请。

## 兼容性

于 2026-10-20 针对最新的稳定桌面版 [`v1.4.230`](https://github.com/stablyai/orca/releases/tag/v1.4.230) 以及 Orca `main` 的 `912c130` 进行了检查（后者自身的 package 版本号为 `1.4.214`；发布线和 `main` 各自独立编号，因此有意义的比较是源码是否一致，而不是这个数字）。

自 `v1.4.192` 检查点以来，有一项面向插件的变更已进入正式发布，本版本正是基于它构建的：

- **`plugin-events.ts` —— `agent.status.changed` 新增了 `mainAgent`。** 该事件的 `state` 一直是 Orca 的*合并*状态：`working` 也涵盖主智能体已结束、但子智能体仍在运行的情况。新增的可选字段 `mainAgent` 携带主智能体自身的 `state`、其最近一次完成回合的 `outcome`，以及由宿主打上的 `stateStartedAt`。本插件现在三者都会使用——参见[集群状态行](#集群状态行)和[已用时间计时器](#已用时间计时器)。

其他变动都是重构，已阅读并判定为无害：

- **`plugin-manifest.ts`** —— `isQualifiedPluginKey`、`pluginPanelTabKey` 和 `isPluginPanelTabKey` 移到了新的 `plugin-tab-key.ts` 并重新导出（已发布）。在 `main` 上，schema 对象另外被命名为 `pluginManifestV1Object`，`contributes` 的默认值改为通过 `prefault({})` 提供，而不是手写的字面量——仍是同样的七个空数组，对于像本插件这样自行声明了 `contributes` 的清单则完全没有影响。
- **`plugin-marketplace.ts`**（仅 `main`）—— 提取了字段映射，并为重复分类和重复 id 的校验规则起了名字。规则本身不变。

两者都没有重命名字段，也没有改变校验内容，但看起来都像是在打基础：一个明确标注为 *V1* 的 schema 对象，以及一个现在以文件名为参数的 marketplace 读取器。

Orca 持续丰富它对每个窗格掌握的信息——`main` 为状态行新增了 `programStatus` 维度（程序自身的 OSC 7501 进度、消息和区块）——但面向插件的投影没有变化，因此这些都不会进入 `agent.status.changed`。四个字段加上 `mainAgent` 仍然是该事件的全部内容。

引擎下限保持为 `>=1.4.0`：所有契约变更都是增量的，而且 `mainAgent` 是可选的，所以在不发送它的宿主上，插件的行为与以前完全相同。

重新阅读上游后确认未变化的部分——这些就是 `src/lib/orca-api.mts` 所转录的契约：

| 上游契约 | 状态 |
| --- | --- |
| Host API v0 方法表（`plugin-host-api.ts`） | 13 个方法，仍全部为 `experimental`；`workspace.readContext` 仍返回 `{ branch, displayName, terminals }` |
| 事件集（`plugin-events.ts`） | 仍是三个 worktree/智能体事件——没有焦点变化事件；`agent.status.changed` 现在还携带可选的 `mainAgent` |
| 权限种类（`plugin-capabilities.ts`） | 仍是七种不带作用域的种类；仍没有 `net:*` |
| 智能体状态（`agent-status-types.ts`） | 仍是 `working` / `blocked` / `waiting` / `done`；状态行更丰富的内部信息中只有 `mainAgent` 进入插件事件的数据 |
| 工作进程环境（`plugin-worker-env.ts`） | 仍是不含 `XDG_RUNTIME_DIR` 的白名单 |
| 空闲回收（`plugin-host-protocol.ts`） | 仍为 5 分钟 |
| 设置与存储位置 | 仍为 `<userData>/plugins-data/<publisher>.<id>/` |
| 清单与 marketplace 的 schema | schema 未变（`plugin-manifest.ts` 的改动只是辅助函数的移动）；`commands[].context` 在本插件中有声明 |

`orca-compatibility.json` 记录了已审阅的 Git blob id。只读的 **Orca compatibility** 工作流每周一检查最新稳定版和 `main`；只要出现新的稳定版本（即使文件没有变化），或任一 ref 中出现契约漂移，它就会失败，从而迫使本节和手写的 API 类型被重新审阅。可以用 `npm run check:orca-compatibility` 在本地运行同样的检查（需要能访问公开的 GitHub API）。

`main` 领先于正式发布数周，所以某个文件可能在那里早已改变，却很久之后才发布。这些尚未发布的对象 id 在阅读过之后会被放进 `verifiedMain`：检查随后不再对它们报错，但一旦 `main` 越过它们就会立即失败；而当 `main` 回到已发布的 id 时，会把该覆盖项标记为已过时——一个没人清理的覆盖项，会继续为之后落到该路径上的任何内容开脱。

清单本可以包含、但被刻意省略的贡献类型：

- **`keybindings`** —— 参见[快捷键](#快捷键)。
- **`panels`** —— 沙箱化的面板只能调用 `workspace.readContext`、`terminal.sendText` 和 `notifications.show`。插件的存储和设置仅工作进程可用，因此 presence 面板无法读取插件正在发布的内容；目前没有什么可显示的。
- **`languagePacks`、`vmRecipes`、`agents`** —— 面向其他类型插件的内容包。
- **`icon`** —— 宿主会校验它，但插件列表中目前还没有任何地方显示它。

## 已知限制

**状态在设计上就是临时的。** Orca 会在插件工作进程没有进行中的任务 5 分钟后将其回收（`PLUGIN_WORKER_IDLE_REAP_MS`），并在下一个事件到来时重新启动。工作进程无法让自己保持存活——只有宿主→工作进程的通信才会刷新空闲计时。因此，状态会在你的集群活跃时出现，在安静几分钟后消失，并在下一个智能体事件时重新出现。集群状态会持久化到插件存储中，所以在这段间隙中不会丢失任何东西；超过六小时的状态会被丢弃，而不会被当作仍然有效的状态恢复。

**聚焦的工作区是轮询获取的，而非推送。** Orca 不会发出焦点变化事件，因此在 `full` 隐私级别下，每 30 秒刷新并重新发布一次工作区和分支。**Show Connection Status** 和 **Reconnect** 会立即刷新它。

**命令参数取决于宿主。** 当 Orca 传递参数时，**Set Header** 接受字符串或 `{ header }`，**Cycle Privacy Level** 接受级别或 `{ privacy }`。截至 `1.4.192`，没有任何宿主路径会传递参数：命令面板和录制的快捷键在调用命令时都不带参数，尽管 IPC 本身可以携带参数。在这一点改变之前，循环切换就是全部的操作方式，自定义标题行需要写在设置文件中。

**工作开始时间戳来自智能体自身所在的主机。** `mainAgent.stateStartedAt` 由智能体运行所在的机器打上时间戳，因此时钟偏差的 SSH 主机可能会让 Discord 的计时器出现偏移。比本机快一分钟以上或早于一天以上的时间戳会被拒绝，改用本地观察到的时刻；偏差小于这个范围的时钟，会让已用时间的读数偏移相同的量。

**Linux 上的套接字发现是启发式的。** Orca 的工作进程环境是一个不含 `XDG_RUNTIME_DIR` 的白名单，因此 `/run/user/<uid>` 是通过 `process.getuid()` 重建的。Flatpak 和 Snap 的目录布局也会被探测。

**插件 API 在上游仍是 EXPERIMENTAL（实验性）的。** Orca 自己的文档表示，在 `pluginApi` v1 冻结之前不承诺任何兼容性。目前之所以能打开本地套接字，只是因为权限模型还没有 `net:*` 这一种类——源码注释中提到计划引入带作用域的种类。未来的 Orca 可能会对此加以限制，届时插件需要声明相应的权限才能继续工作。

**Discord 对 `SET_ACTIVITY` 有频率限制。** 更新会进行防抖（1.5 秒），两次发布之间至少间隔 4 秒，完全相同的内容则直接跳过。

**工作进程自身的日志在 Settings 中。** 当 **Show Connection Status** 不够用时，Settings → Plugins → *View logs* 会显示工作进程记录的内容——连接失败、权限被拒以及被拒绝的事件都会记录在那里。

## 开发

```bash
git clone https://github.com/LuticaCANARD/orca-discord-presence.git
cd orca-discord-presence
npm install
npm run build      # tsc → dist/
npm test           # build + node --test (99 tests)
npm run typecheck  # no emit
```

在 Settings → Plugins → *Add development plugin* 中选择检出的目录，即可将其加载到 Orca 中。

```text
orca-plugin.json            manifest (validated against the host schema by a test)
orca-marketplace.json       marketplace index — lets this repo be its own source
orca-compatibility.json     reviewed Orca release and plugin-contract object ids
scripts/check-orca-compatibility.mjs
                            latest-release and main contract drift check
src/main.mts                worker entry: activate/deactivate, commands, events
src/lib/orca-api.mts        hand-maintained types for Orca's plugin worker API
src/lib/presence-model.mts  pure state model — events in, activity payload out
src/lib/discord-ipc.mts     Rich Presence IPC client over node:net
src/lib/socket-path.mts     socket discovery across platforms and sandboxes
orca-compatibility.json     reviewed upstream blob ids — the baseline the weekly check compares against
scripts/check-orca-compatibility.mjs  the check itself (also runs as a workflow)
.github/actions/verify-build  the gates, shared by CI and both release paths
.github/workflows/          CI, tag-and-release, release, orca-compatibility
```

安装后的目录树会被计算哈希，并限制在 2,000 个文件和 50 MiB 以内，本仓库远未达到这个上限——之所以值得一提，只是因为编译产物也包含在其中。

`dist/` **是有意提交的。** Orca 会原样安装插件目录，宿主端没有构建步骤，所以编译后的入口必须放在仓库里。当 `dist/` 与 `src/` 不一致时，CI 会让构建失败。

Orca 没有为插件作者提供类型包，因此 `src/lib/orca-api.mts` 转录了宿主的契约（`plugin-host-api.ts`、`plugin-events.ts`、`plugin-capabilities.ts`）。Orca 升级后若在那里出现类型错误，那是一个真实的信号——先读懂它，再考虑用类型转换绕过。

### 发布新版本

**提升版本号就是发布。** 以下位置都带有版本号，只要它们不一致，测试就会失败：

1. `package.json` → `version`
2. `orca-plugin.json` → `version`
3. `orca-marketplace.json` → `plugins[].source.ref`（形式为 `v<version>`）
4. `README.md` 及其翻译（`README.ko.md`、`README.ja.md`、`README.zh-CN.md`）→ 安装 URL 中的 `#v<version>` 片段

运行 `npm run build`，提交所有改动的文件，然后合并到 `main`。随后 **Tag and release** 会读取清单中的版本号，若该标签已存在则停止，运行各项检查，只有通过后才会创建标签并发布 release——因此标签永远不会指向一棵未通过自身检查的代码树，也不会有任何标签是从笔记本电脑上打出来的。像 `0.4.0-rc.1` 这样的版本会作为预发布版本发布。

旧的方式仍然可用：自己推送一个 `v*` 标签，**Release** 会将其与清单进行核对并发布。这种方式适用于从旧提交重新发布，而不是用于常规发布。

| 工作流 | 触发条件 | 作用 |
| --- | --- | --- |
| **CI** | 每次推送到 `main`、每个 PR | 运行各项检查 |
| **Tag and release** | 推送到 `main` | 为尚无标签的版本打标签并发布 |
| **Release** | 手动推送的 `v*` 标签 | 将标签与清单核对后发布 |
| **Orca compatibility** | 每周一，或手动触发 | 读取上游，若有未审阅的内容则失败 |

这些检查本身——类型检查、构建、`dist/` 与 `src/` 一致性，以及测试——统一定义在 `.github/actions/verify-build` 中，因此三条路径都不会悄悄地彼此偏离。

marketplace 条目固定的是**发布标签**，而不是 `main`——分支引用会在下次 marketplace 刷新时重新解析为当时的 HEAD，悄无声息地把用户带到尚未发布的提交上。有测试强制要求该引用是一个标签，并且与清单中的版本号一致。

## 许可证

MIT
