/*
 * 移植自 lingyun/YoYoMusic tauri 分支 src/features/visualization/modes.ts。
 * 适配点：
 *   1. 去 react / shared/icons / shared/types 依赖 —— 图标与 hint 的 ReactNode 渲染
 *      归顶栏菜单（Task 11），此处保留框架无关的 id/label/hint 目录；
 *   2. 末尾新增 piano 项（Go internal/ui/viz.go 的 3D 钢琴，本 Task 用 Canvas 2D 重写），
 *      VIZ_LABELS 的中文标签照抄 Go app.go vizLabels（频谱柱/示波波形/…/万花筒/钢琴）。
 *
 * 顺序即菜单顺序：分析类在前，其后是表演类，最后是生成/重绘制的两类。
 */

export interface VisualizationModeMeta {
  id: string;
  label: string;
  hint: string;
}

/*
 * The visualiser mode catalogue. Order is intentional: the analyses first, then
 * the showpieces, then the two that are generated rather than plotted.
 */
export const visualizationModes: VisualizationModeMeta[] = [
  { id: "spectrum", label: "频谱柱", hint: "镜像频谱条与峰值保持" },
  { id: "waveform", label: "示波波形", hint: "发光示波曲线" },
  { id: "radial", label: "环形律动", hint: "环形放射律动" },
  { id: "aurora", label: "音浪绸带", hint: "流动音浪绸带" },
  { id: "particles", label: "粒子星尘", hint: "节拍粒子星尘" },
  { id: "waterfall", label: "镜像瀑布", hint: "滚动频谱瀑布" },
  { id: "generative", label: "生成动画", hint: "程序化生成，每隔十几秒自动换一种形态" },
  { id: "kaleidoscope", label: "万花筒", hint: "频谱驱动的镜像花瓣" },
  { id: "piano", label: "钢琴", hint: "立体键盘随频谱起落" },
];
