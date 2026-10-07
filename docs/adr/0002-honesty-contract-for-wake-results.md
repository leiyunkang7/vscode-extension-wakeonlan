---
status: accepted
---

# 唤醒结果的诚实契约：证据阶梯与"没有证据就不许断言"

唤醒之后扩展能诚实说什么，由一张五级证据阶梯和一条禁止规则共同定死：`responded`（有正面证据，v0.1.0 永不产生，仅预留）/ `sent`（发送方事实）/ `timed-out`（未确认）/ `partial` 与 `failed`（反证）。`message.WakeSuccess` 与 `message.WakeFailed` 双双删除——后者的主语是目标机器，而 MAC 非法、网卡缺 netmask、`EACCES` 这些真实可达的失败路径全属发送侧，把它们报成"唤醒失败"是**在没有证据的地方制造反证**。

判据不是"字符串的主语是谁"，而是"**扩展是否持有支撑它的证据**"：有证据支撑的状态断言允许；无证据的禁止；对所有 WOL 设备都成立的有保留预期允许。等待提示因此可以写"通常需要几十秒"却不能写"约 15 秒"。

## Considered Options

- **保留 `WakeFailed`、只重新定义语义**（改为"报文未能发出"）：是在给一个已经欠债的键换债主。中英文案殊途同归，用户看到"唤醒失败"仍会读成"机器没醒"。被否。
- **两级阶梯**（`已发出` / `有问题`）：省掉 `timed-out` 与 `partial` 的独立措辞。但四级里 `partial` 与 `failed` 告诉用户接下来该做什么完全不同（重试 vs. 改配置），合并后无法表达；且 VS Code 只有 Info/Warning/Error 三级，`timed-out` 与 `partial` 同级 Warning，**必须靠措辞而非颜色区分**——色弱用户截图转发时颜色就没了。被否。
- **三级阶梯**（`timed-out` 并入 `failed`）：直接违反"未确认与反证必须分开"。被否。
- **报文构造失败单列一级**：它是发送的**前置条件**失败而非发送结果，单列会让证据阶梯多出一级不属于任何证据类的东西。归入 `failed` + `ReasonDeviceInvalid`。被否。
- **"主语是目标机器就不许存在"**：Q8 预留的 `responded` 主语恰恰是目标机器，会把这张票自己否掉。判据必须是证据而非主语。被否。
- **成功静默、只在出问题时弹**：与"成功也弹"相比少一次确认，但唤醒本就是低频操作，没有省下可观的噪声。被否。
- **成功也弹 + 树节点 spinner→对勾**：我最初推荐这一条，理由是"通知会永久堆积"。**该理由经核实为假**（见 Consequences），且它要拖进重入保护。改推"每次都弹"。

## Consequences

- **通知时长不可控，但状态栏时长可控。** 扩展 API 的 `MessageOptions` 至今只有 `modal` 与 `detail` 两个字段（`release/1.138` 的 `src/vscode-dts/vscode.d.ts` 已核实），全部约 90 个 `vscode.proposed.*.d.ts` 中无任何提案添加时长字段。workbench UI 层在 `notificationsToasts.ts:33-37` **硬编码**了按级别的自动清除：Info 10s / Warning 12s / Error 15s。**扩展甚至拿不到 handle**——`_showMessage` 把 `messageHandle` 留作局部变量，无法关闭、缩短或取消自己发出的通知。唯一的例外是 `setStatusBarMessage` 的 `IStatusMessageOptions { showAfter, hideAfter }`，那是**状态栏**的接口，不是通知的。因此票据正文点名的"超时时长"对通知而言无解。等待提示因此**刻意不带数字**。
- **标称时长是上界而非保证，且窗口失焦时定时器根本不启动。** `purgeTimeoutHandle` 在每次延后时**重新计满一整轮**（悬停 / 通知列表有焦点 / 窗口失焦各重启一次完整超时），所以实际停留时长**无上界**；窗口失焦时定时器被**挂起**而非仅延后，直到 `onDidChangeFocus` 触发才补上一整轮。对唤醒场景这条基本无害——用户发完包去忙别的事，回来时 toast 还在——但它意味着"10 秒后自动消失"这句话对规格是错的。
- **两条与诚实契约无关但影响同一处代码的事实**：同时最多 3 条 toast，800ms 窗口内来第 4 条会被静默丢弃为 toast（仍进通知中心）；相同 source 与**逐字节相同的渲染后文案**再次调用会**顶替**旧 toast 而非叠加。注意是**渲染后文案**——本票的 `message.WakeSent` 内嵌 `{targets}` 与 `{packets}`，因此去重**只在这些占位符恰好相同时成立**（连点唤醒同一台设备成立，唤醒不同设备或改包数则各占一条）。若将来加"全部唤醒"批量命令，逐设备 toast 会**按构造丢失 N-3 条**，届时必须把批次汇总成一条消息。
- **`failed` 天然持久，但粘住的条件是 Error + *主要* 动作。** `common/notifications.ts:593-607` 里 `sticky` 是推导值：`hasActions && severity === Error`。`hasActions` 只计**主要动作**，VS Code 自动附加的"管理扩展"次要按钮不算。注意这个不对称——**裸的 `showErrorMessage` 仍然 15 秒消失，加了按钮才变成永久**。还有一条非直觉路径：`canCollapse` 返回 `!hasActions`，用户**双击一条无按钮的 toast 会把它展开并永久粘住**。`failed` 是唯一同时满足 Error + 主要动作的级别，于是它的 `[查看日志]` 按钮会一直留到用户点掉；`sent` 10 秒淡出。**证据阶梯与提示持久性自动对齐：反证留下，发送方事实淡出。**
- **原始错误码永不进用户可见文案。** 短理由是给人读的（`设备信息无效` / `找不到可用的网络接口` / `目标地址不可达`）；raw code 连同 `destination` / `source` / `packetCount` 只进日志。`skipped` 不产生理由——VPN 上的 `/32` 接口是常态，把它算成问题会让正常用户收到不必要的警告，它只安静地减少目标数。
- **`I18n` 必须先修。** `format` 只匹配 `/{(\d+)}/`，撑不起具名占位符；`t` 对未知 key 返回 `''`，会渲染出一条只剩设备名的空通知，而空通知在视觉上与成功提示无从区分。未知 key 的回退值定为 **key 本身**——这条改动成本几乎为零，却让禁止规则在实现期可审计。
- **`[查看日志]` 按钮的落点未定。** 它指向[这个扩展需不需要一个诊断面](https://github.com/leiyunkang7/vscode-extension-wakeonlan/issues/10)。若该票判定不需要诊断面，则按钮撤除、`failed` 的短理由直接作为 toast 主文案、raw code 不上屏。日志本身**每次唤醒都写**（而非只在出错时），因为 `timed-out` 的文案是"无法确认是否已发出"——此时点进空日志等于在最需要帮助的时刻被抛弃。
- **`workbench.notifications.toast` 与 `workbench.notifications.doNotDisturbMode` 不存在。** 后者在 application storage 而非 `settings.json`；`workbench.notifications.*` 下真实存在的只有 `position` 与 `showInTitleBar`，均不影响时长。写规格时勿引用。
- **本契约只约束关于目标的断言。** GLOSSARY 边界写着「唤醒结果里的每一句断言都是相对于发包位置的」，因此**发包位置不对不落入本契约的禁止规则**：那种情况下扩展说的仍是真话，只是发在了听不见的地方。它是可用性失效，不是否定性证据缺失；不为它建拒绝机制的理由记在[0005](0005-sending-position-disclosure-not-refusal.md)。
- **`sent` 的证据是「内核接受了报文」，不是「报文离开了网卡」。** `dgram` 的 `send` 回调在报文交给内核后即 resolve，它不证明帧已上线。这个精度在本地场景不显眼，在发包位置听不见目标时更显眼——那里的 `sent` 离「目标收到了」远得多。
