# dsh-roco-daily 🐟🎮

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的《洛克王国：世界》日常自动化插件，和 **DSH 桌宠**（[dsh-pet](https://github.com/PC2005-cloud/dsh-pet)）联动。

**运行时零 LLM 调用。** 整个流程就是「看几个像素 → 点几下鼠标」，不写 prompt、不烧 token、不联网（除了本机桌宠的 `127.0.0.1`）。

```
你点桌宠右键「洛克日常」
        │
        ▼
   桌宠锁住自己 → 播 working 动作 → 气泡「去跑日常了」
        │
        ▼
   roco-daily 执行器（纯本地脚本）
        ├─ 校验游戏窗口在不在
        ├─ 第 1 步：等画面出现预期色点 → 点一下 → 等 1.2 秒
        ├─ 第 2 步：……
        └─ 每步完成 → 气泡播报「2/3 旅行商人 ✓」
        │
        ▼
   成功 → 播 success 动作 + 汇总气泡 → 解锁
```

## 它**不**做什么

- ❌ 不读内存、不改游戏文件、不碰协议包、不发请求给游戏服务器
- ❌ 不做战斗（战斗请用游戏自带的「自动战斗 + 双倍倍速」）
- ❌ 不会盲点：**没校准过的步骤一律跳过**，窗口不在就一步都不点
- ❌ 不调用任何模型

## 安装

```powershell
# 1) 把仓库放到固定位置（link 安装要求路径不能乱动）
git clone https://github.com/BAIYOU9259/dsh-roco-daily.git "$env:USERPROFILE\.dsh\plugins\dsh-roco-daily"

# 2) 注册到 DSH（桌面端用 --profile desktop；dsh web 用 --profile web）
dsh plugin --profile desktop add "link:$env:USERPROFILE\.dsh\plugins\dsh-roco-daily"

# 3) 重启 DSH
```

重启后，DSH 一启动插件就会 `apply()`：桌宠菜单挂上、排班计时器起来。**不需要额外开机自启**——DSH 开着它就活着。

## 第一次用（四步）

```powershell
cd "$env:USERPROFILE\.dsh\plugins\dsh-roco-daily"

# ① 确认能找到游戏窗口 + 截一张图看看
node tools/cli.mjs probe

# ② 校准：把鼠标移到按钮上按回车，它记住坐标和颜色
node tools/cli.mjs calibrate --step gubiji

# ③ 演练：只取色不点击，确认每步都能"看见"
node tools/cli.mjs run --dry

# ④ 真跑
node tools/cli.mjs run
```

`calibrate` 会把结果写进 `~/.dsh/roco-daily.json`。

## 配置

`~/.dsh/roco-daily.json`（改完不用重启，下一次跑就读新值）：

```jsonc
{
  "enabled": true,
  "game": {
    "title": "洛克王国",          // 窗口标题子串
    "activateBeforeRun": true    // 跑之前把窗口拉到前台
  },
  "pet": { "enabled": true, "lock": true, "labels": ["洛克日常"] },
  "schedule": {
    "enabled": true,
    "time": "21:30",
    "days": [1,2,3,4,5,6,7],     // ISO 星期，1=周一
    "catchUp": true              // DSH 开着时错过时间点也补跑
  },
  "steps": [
    {
      "id": "gubiji",
      "name": "古币机",
      "anchors": [{ "x": 120, "y": 300, "rgb": [40, 120, 200] }],
      "click": { "x": 120, "y": 300 },
      "after": 1200,             // 点完等多久（毫秒）
      "timeout": 6000,           // 等这个画面出现最多多久
      "optional": true           // true = 没等到就跳过，不中断
    }
  ]
}
```

- `anchors` 为空 = 这一步永远不会执行（安全默认）。
- 想加步骤：复制一段，改 `id` / `name`，再 `calibrate --step <id>`。
- 想加多个色点提高判定准确度：往 `anchors` 里多塞几个 `{x,y,rgb}`，**全部命中**才点。

## 桌宠位置（petAnchor）

dsh-pet 自己**不记**位置——每次启动都按 `config.jsonc` 里的 `position.corner` 重算，你拖到哪都没用。本插件补上这一层：

- **记**：每 10 秒把「屏内归一化坐标 + 当时在哪块屏」写进 `~/.dsh/roco-daily/pet-anchor.json`
- **放回去**：DSH 启动 15 秒后归位一次（等桌宠起来）
- **换屏按比例**：原来的屏不在了（拔了副屏 / 分辨率变了），用同一组 `nx/ny` 落到现存的屏上，位置等比
- **不动的时候不动**：同屏且偏差 < 1% 就跳过，不会每 10 秒抖一下

```jsonc
"petAnchor": { "enabled": true, "saveEveryMs": 10000, "tolerance": 0.01 }
```

命令行：

```powershell
node tools/cli.mjs anchor            # 看存档 / 当前位姿 / 窗口矩形 / 屏幕列表
node tools/cli.mjs anchor --save     # 立刻记一次
node tools/cli.mjs anchor --restore  # 立刻归位
```

> 注意：`/position` 只能挪屏内归一化坐标，**不能跨屏搬窗口**。所以"记住在哪个屏"依赖窗口自己启动时落在哪块屏；跨屏恢复要 dsh-pet 上游支持。

## 排班

- `schedule.enabled = true` 且 DSH 开着 → 到点自动跑（每 30 秒检查一次）。
- 同一天只跑一次（记在 `~/.dsh/roco-daily/state.json`）。
- `catchUp = false` → 只在时间点后 15 分钟内触发，不补跑。
- DSH 没开的那天不会跑（本插件不装 Windows 计划任务，避免一个后台定时器在你看不见的地方动鼠标）。

## 测试

```powershell
node --test test/*.test.mjs     # 47 个用例：匹配、排班、配置、执行器、桌宠桥、位置锚点
```

测试全部用假窗口 / 假桌宠，不碰真实鼠标键盘。

## 已知限制

| 限制 | 说明 |
|---|---|
| 仅 Windows | 依赖 `user32` / `gdi32` |
| 独占全屏抓不到 | 游戏必须**窗口化 / 无边框窗口**，否则截出来是黑的 |
| DPI 缩放 | 100% 缩放最稳；125% 以上请重新校准 |
| 画面会动 | 色点判定对动态背景不友好，尽量选**纯色按钮**的角上取点 |
| 版本更新 | UI 一改，锚点就失效——重新 `calibrate` 即可 |

## 免责

自动化操作可能违反《洛克王国：世界》用户协议，**封号风险由使用者自行承担**。本项目只做「模拟鼠标点击 + 读屏幕像素」，不修改任何游戏数据，但那不等于合规。建议用小号试。

## 许可

MIT
