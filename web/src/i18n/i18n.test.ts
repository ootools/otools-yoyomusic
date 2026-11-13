/*
 * Task 10 Step 1 失败测试：i18n（zh-CN 源表 + en-US 翻译 + locale 三级回退）。
 *
 * zh 源文案照抄 Go D:\Repos\xyito\lingyun\YoYoMusic internal/ui/view.go 与
 * internal/ui/lyrics_desktop.go（spec §8 各节）。模块内有单例状态（当前
 * locale + 订阅表），每个用例用 vi.resetModules + 动态 import 取全新实例，
 * 避免用例间串扰；__OTOOLS_LOCALE__ / navigator.language 在 import 前 mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  delete window.__OTOOLS_LOCALE__;
  vi.unstubAllGlobals();
});

afterEach(() => {
  delete window.__OTOOLS_LOCALE__;
  vi.unstubAllGlobals();
});

type I18n = typeof import('./index');

/** 载入全新 i18n 实例（配合 beforeEach 的 resetModules）。 */
async function load(): Promise<I18n> {
  return import('./index');
}

describe('t()（zh-CN 源表，文案照抄 Go 原文）', () => {
  it('空态文案逐字：library.empty（Go view.go:876）', async () => {
    window.__OTOOLS_LOCALE__ = { locale: 'zh-CN' };
    const { t } = await load();
    expect(t('library.empty')).toBe('还没有音乐。\n点右上角的 + 导入音乐或文件夹。');
  });

  it('历史/喜欢空态与桌面歌词占位逐字（view.go:1053/1121、lyrics_desktop.go:153）', async () => {
    window.__OTOOLS_LOCALE__ = { locale: 'zh-CN' };
    const { t } = await load();
    expect(t('history.empty')).toBe('还没有播放记录。\n播放过的歌曲会显示在这里。');
    expect(t('likes.empty')).toBe('还没有喜欢的歌曲。\n点歌曲右侧的 ♥ 把它加入『我喜欢』。');
    expect(t('lyricsDesktop.none')).toBe('暂无歌词');
  });

  it('播放模式 4 标签与 EQ 7 预设名照抄 Go（app.go:645-656、view.go:1335-1336）', async () => {
    window.__OTOOLS_LOCALE__ = { locale: 'zh-CN' };
    const { t } = await load();
    expect(t('playMode.sequence')).toBe('顺序播放');
    expect(t('playMode.repeatAll')).toBe('列表循环');
    expect(t('playMode.repeatOne')).toBe('单曲循环');
    expect(t('playMode.shuffle')).toBe('随机播放');
    expect(t('eq.preset.flat')).toBe('平直');
    expect(t('eq.preset.bass')).toBe('重低音');
    expect(t('eq.preset.treble')).toBe('高音');
  });

  it('{name} 插值：相对时间词 / 计数 / 播放模式 tooltip', async () => {
    window.__OTOOLS_LOCALE__ = { locale: 'zh-CN' };
    const { t } = await load();
    expect(t('time.minutesAgo', { n: 5 })).toBe('5分钟前');
    expect(t('library.countTracks', { count: 12 })).toBe('12 首');
    expect(t('transport.modeTip', { mode: '顺序播放' })).toBe('顺序播放（点击切换）');
    // 未提供的变量保留占位原样。
    expect(t('time.hoursAgo')).toBe('{n}小时前');
  });

  it('en-US 完整翻译：setLocale 后 t 切换', async () => {
    window.__OTOOLS_LOCALE__ = { locale: 'zh-CN' };
    const { t, setLocale } = await load();
    expect(t('panel.eq')).toBe('均衡器');
    setLocale('en-US');
    expect(t('panel.eq')).toBe('Equalizer');
    expect(t('library.empty')).toBe('No music yet.\nClick the + in the top-right corner to import music or a folder.');
    setLocale('zh-CN');
    expect(t('panel.eq')).toBe('均衡器');
  });

  it('en 缺键回退 zh 源表；两表皆缺返回 key 本身', async () => {
    window.__OTOOLS_LOCALE__ = { locale: 'en-US' };
    const { t } = await load();
    const { messages } = await import('./en-US');
    const saved = messages['panel.eq'];
    delete (messages as Record<string, string>)['panel.eq'];
    expect(t('panel.eq')).toBe('均衡器');
    messages['panel.eq'] = saved;
    expect(t('no.such.key')).toBe('no.such.key');
  });
});

describe('currentLocale()（__OTOOLS_LOCALE__ → navigator.language → zh-CN 三级回退）', () => {
  it('第 1 级：__OTOOLS_LOCALE__ 优先（en-US / zh-CN）', async () => {
    window.__OTOOLS_LOCALE__ = { locale: 'en-US' };
    const i18n = await load();
    expect(i18n.currentLocale()).toBe('en-US');
  });

  it('第 2 级：无注入时读 navigator.language（zh 前缀 → zh-CN，其余 → en-US）', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    const i18n = await load();
    expect(i18n.currentLocale()).toBe('zh-CN');

    vi.stubGlobal('navigator', { language: 'fr-FR' });
    vi.resetModules();
    const i18n2 = await load();
    expect(i18n2.currentLocale()).toBe('en-US');
  });

  it('第 3 级：两者皆缺 → 缺省 zh-CN；__OTOOLS_LOCALE__ 空值跳到 navigator', async () => {
    vi.stubGlobal('navigator', undefined);
    const i18n = await load();
    expect(i18n.currentLocale()).toBe('zh-CN');

    window.__OTOOLS_LOCALE__ = { locale: undefined };
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.resetModules();
    const i18n2 = await load();
    expect(i18n2.currentLocale()).toBe('en-US');
  });
});

describe('onLocaleChange()（手动 setLocale + 宿主 otools-locale-changed 事件）', () => {
  it('订阅立即回调当前值；setLocale 推送新值；退订后不再收到', async () => {
    window.__OTOOLS_LOCALE__ = { locale: 'zh-CN' };
    const { onLocaleChange, setLocale } = await load();
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    expect(seen).toEqual(['zh-CN']); // 立即回调一次

    setLocale('en-US');
    expect(seen).toEqual(['zh-CN', 'en-US']);

    off();
    setLocale('zh-CN');
    expect(seen).toEqual(['zh-CN', 'en-US']); // 退订后无推送
  });

  it('宿主 otools-locale-changed 事件推动切换（无手动覆盖时）', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    const { currentLocale, onLocaleChange } = await load();
    const seen: string[] = [];
    onLocaleChange((l) => seen.push(l));
    expect(currentLocale()).toBe('zh-CN');

    window.dispatchEvent(new CustomEvent('otools-locale-changed', { detail: { locale: 'en-US' } }));
    expect(currentLocale()).toBe('en-US');
    expect(seen).toEqual(['zh-CN', 'en-US']);
  });
});
