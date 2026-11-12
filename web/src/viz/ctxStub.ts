/*
 * 测试专用 CanvasRenderingContext2D 桩（Task 9）。
 *
 * 记录被调用的方法名、属性写入与渐变停靠点，任何方法调用都返回合理值（渐变工厂
 * 返回带 addColorStop 的桩），让 9 种可视化能在无 canvas 实现的 jsdom 里各跑若干帧
 * 不抛。仅供 *.{test,spec}.ts(x) 引用，app 代码不得 import。
 */

export interface CtxStub {
  ctx: CanvasRenderingContext2D;
  /** 被调用的方法名序列（含渐变 addColorStop）。 */
  calls: string[];
  /** 属性写入记录（fillStyle/globalAlpha/shadow* 等），键为属性名、值为最后一次写入。 */
  props: Record<string, unknown>;
  /** 渐变停靠点记录，按创建顺序。 */
  stops: Array<[number, string]>;
}

export function makeCtxStub(w = 640, h = 360): CtxStub {
  const calls: string[] = [];
  const props: Record<string, unknown> = {};
  const stops: Array<[number, string]> = [];

  const gradient = {
    addColorStop(offset: number, color: string): void {
      stops.push([offset, color]);
      calls.push('addColorStop');
    },
  };

  const target = {
    canvas: { dataset: {} as Record<string, string>, width: w, height: h },
  };

  const stub = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === 'canvas') return t.canvas;
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return (..._args: unknown[]) => gradient;
      }
      if (prop in t) return Reflect.get(t, prop, receiver);
      // 样式/状态属性（fillStyle、globalAlpha、shadow* 等）：读返回 undefined 会
      // 破坏算术，这里读返回 undefined 前先看是否被写入过（写入走 set 存到 t）。
      return (...args: unknown[]) => {
        void args;
        calls.push(String(prop));
      };
    },
    set(t, prop, value) {
      if (typeof prop === 'string') {
        props[prop] = value;
        calls.push(`${prop}=`);
      }
      return Reflect.set(t, prop, value);
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx: stub, calls, props, stops };
}
