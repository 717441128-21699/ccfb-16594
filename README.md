# 高尔夫手机慢动作挥杆分析 / Golf Blur Launch Monitor

一个纯前端 TypeScript + React + Vite 原型：从手机 240fps 慢动作视频中搜索杆头，利用最快挥杆帧的运动拖影长度/方向、相邻帧轨迹和标定尺度估计：

- 杆头速度（m/s、mph）
- 击球前后杆面相对目标线开/关角度
- 杆头路径由内向外 / 由外向内角度
- 挥杆平面与杆头轨迹 Canvas 叠加
- 左曲 / 右曲 / 直球 / push / pull 等球路
- 学员档案、雷达同步真值对标和通过率统计

> 重要边界：单目手机视频不能无假设地等价于多普勒雷达。当前仓库的 **20 个合成样例（10 组球 × 正对/侧对）** 已达到下面的数值验收；真实球场视频还需要用同步雷达十球测试，并校准曝光时间、机位纵深系数和球/杆尺度。应用内已提供雷达数值录入、误差判定和 CSV 模板。

## 快速开始

```powershell
npm install
npm run dev
```

构建和单元测试：

```powershell
npm run build
npm test
```

重新生成 20 个 5 秒 / 240fps / 640×360 的 H.264 MP4 毛病样例（需要 `ffmpeg` 在 PATH）：

```powershell
npm run samples:generate
```

只生成某个样例：

```powershell
npx vite-node scripts/generate-samples.ts --only=b04-slice-side --force
```

运行合成真值精度验证并刷新 `VALIDATION.md` 与 `public/samples/validation-report.json`：

```powershell
npm run samples:validate
```

## 页面与流程

1. **视频导入页**
   - 上传 MP4/MOV/WebM，或点击 10 组典型毛病 × 两种机位的生成样例。
   - 选择“侧对学员”或“正对学员”。
   - 样例卡片直接显示杆头速度、杆面角、路径角和球方向真值。

2. **尺度标定页**
   - 拖动球直径两端、球杆握把/杆头两端、目标线、学员/内侧方向点。
   - 标准球直径：42.67mm。
   - 默认球杆长度：1067mm（42in，可改）。
   - 设置帧率和曝光时间；拖影速度公式为  
     `v = (拖影像素长度 - 杆头直径修正) × mm/px ÷ 曝光秒数`。

3. **挥杆分析页**
   - 解码画布使用 640px 宽（与验证分辨率一致），帧 Buffer 通过 Transferable 发给 Web Worker；可在 `analysisClient.ts` 降到 480px 换取低端机速度。
   - Worker 运行亮边杆面检测、运动/背景差分、PCA 方向、拖影径向测量、相邻帧鲁棒速度和击球簇选择，不阻塞 UI。
   - Canvas 叠加挥杆平面、轨迹、击球点、杆面法向和路径方向。
   - 可输入同步雷达速度、杆面角和球方向，即时显示 ≤5%、≤2°、方向判对状态。
   - 可保存到学员档案。

4. **学员档案页**
   - localStorage 保存学员和记录。
   - 汇总速度 ≤5%、杆面 ≤2°、方向判对次数，并给训练建议。

## 合成验收结果

最新完整报告见 [`VALIDATION.md`](./VALIDATION.md)。当前结果：

- 速度偏差 ≤5%：**20/20 机位，10/10 组球双机位均通过**
- 杆面角偏差 ≤2°：**20/20 机位，10/10 组球双机位均通过**
- 球路方向：**20/20 机位判对，10/10 组球双机位均判对**
- 击球帧：全部命中真值第 840 帧，误差 0 帧
- Node/Vite-node 中 640×360、1200 帧纯跟踪平均约 **4.3s**，最大约 **7.3s**；H.264 解码后的基线样例抽测仍正确命中第 840 帧。浏览器端到端耗时取决于视频 seek/硬件解码，低端机可把 `analysisWidth` 降到 480 并同步做阈值缩放/标定验证。

这些数字证明算法、相机角度反演和 UI 数据链路自洽，但**不是真实雷达精度认证**。真实 paired-radar 测试请复制 [`radar-cotest.template.csv`](./radar-cotest.template.csv)，按同时测量的十球填写；应用档案页也会计算同一组指标。

## 典型毛病样例与真值

| ID | 毛病 | 速度 m/s | 杆面角 °（+ 开/右） | 路径角 °（+ 内→外） | 球方向 ° |
|---|---|---:|---:|---:|---:|
| b01-straight | 基准直球 | 46.0 | +0.4 | +0.2 | +0.5 |
| b02-draw | 标准小左曲 | 47.2 | +1.1 | +4.4 | -4.8 |
| b03-fade | 标准小右曲 / over-the-top | 46.8 | +1.8 | -2.8 | +5.4 |
| b04-slice | 严重右曲 / slice | 45.1 | +5.6 | -6.2 | +18.5 |
| b05-hook | 严重左曲 / hook | 47.8 | -3.8 | +6.4 | -16.5 |
| b06-push | 直推右 | 45.6 | +3.8 | +3.4 | +4.1 |
| b07-pull | 直拉左 | 44.9 | -3.7 | -3.3 | -4.0 |
| b08-over-top | over-the-top 陡下杆 | 46.4 | +0.8 | -5.4 | +6.8 |
| b09-early-release | 提前释放 / cast | 39.7 | +2.4 | +0.9 | +3.2 |
| b10-shallow | 过平平面 | 48.3 | -1.6 | +5.8 | -7.5 |

每个 ID 都生成 `side`（侧对）和 `face-on`（正对）两个视频，共 20 个。机器可读真值：

- `public/samples/manifest.json`
- `public/samples/truth.json`
- `public/samples/validation-report.json`

## 代码结构

```text
src/
  types.ts                     # 领域类型与雷达/真值结构
  App.tsx                      # 四个页面的状态路由
  components/
    ImportPage.tsx             # 视频导入 + 样例库
    CalibrationPage.tsx        # 归一化拖点标定
    AnalysisPage.tsx           # Worker 进度、指标、雷达对标、保存
    AnalysisOverlay.tsx        # Canvas 挥杆平面/轨迹/角度叠加
    ProfilesPage.tsx           # 学员档案与十球统计
  lib/
    geometry.ts                # 尺度、目标线/内侧轴、单目角度基反演、PCA 直线
    shotPhysics.ts             # 拖影速度、速度融合、face/path -> 球路
    tracker.ts                 # 纯 TS 杆头搜索与 finalize 分析
    analysisClient.ts          # 视频逐帧解码、Transferable Worker 协议
    validation.ts              # 方向分类与误差验收
    storage.ts                 # localStorage 学员/记录
  workers/
    tracker.worker.ts          # 重活 Worker
  samples/
    cases.ts                   # 十组真值与两种机位标定
    renderer.ts                # 无 DOM 依赖的 RGBA 合成挥杆渲染器
scripts/
  generate-samples.ts          # RGBA -> ffmpeg -> MP4
  validate-samples.ts          # 20 个机位的真值验证报告
```

## 单目角度模型

图像中的方向由两个用户标定轴表示：

```text
imageVector ≈ cos(horizontalAngle) · targetAxis
            + sin(horizontalAngle) · depthCompression · insideAxis
```

`depthCompression` 表示目标线纵深方向在当前手机机位下的透视压缩。标定页可微调。检测到的杆面亮边先得到屏幕直线方向，再通过该二维基反演为相对目标线的水平杆面角；轨迹切向用同一模型反演路径角。

球路使用经典球飞规律的可解释近似：

```text
launch ≈ 0.82 · face + 0.18 · path
curvature ∝ face - path
```

正的 `face - path` 给 fade/slice 弯曲项，负的给 draw/hook 弯曲项。

## 真实视频达到雷达指标的建议

1. 使用手机相机的 240fps 模式并锁定曝光/对焦；记录实际快门时间。
2. 侧对机位尽量让目标线平行成像平面；正对机位让标定目标线和内侧点尽量准确。
3. 球、完整球杆和击球前后 5 帧必须清晰可见；强逆光/夜间噪点会降低亮边检测率。
4. 每个学员先同步雷达打 10 球，在分析页录入雷达速度和杆面角，检查系统偏差。
5. 如果速度整体偏高/偏低，优先修正曝光时间和融合 `mm/px`；如果角度整体偏置，微调纵深系数。
6. 真实雷达通常还提供垂直发射角、旋转、spin axis；本原型只估计水平 face/path 与近似球路。
