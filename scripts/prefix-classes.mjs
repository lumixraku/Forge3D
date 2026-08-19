/**
 * 给 Forge3D 的样式类名加前缀，让这套 UI 能安全嵌进别的宿主站点。
 *
 * 背景：Forge3D 原本独占整个 document，Tailwind 生成的 `.border` `.flex` 这类通用类名
 * 和宿主站点（如 fe-tripo-studio 的 UnoCSS）会互相覆盖，宿主的全局 reset 也会压掉
 * 这里的 utility。加上前缀后两套体系类名不再相交，迁移就退化成纯拷贝。
 *
 * 两类改写：
 *   1. Tailwind utility → `forge:` 变体前缀（由 styles.css 的 `prefix(forge)` 生成）
 *   2. 业务语义 class    → `forge3d-` 普通前缀（手写 CSS、JS 引用、任意变体里的选择器）
 *
 * 第三方约定的 class 必须保持原名，否则库读不到（见 KEEP）。
 *
 * 用法：node scripts/prefix-classes.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SRC = 'src';
const TW_PREFIX = 'forge';
const BIZ_PREFIX = 'forge3d-';

// 第三方库按名字识别这些 class，改名即失效。
const KEEP = new Set([
  'nodrag', // VueFlow：标记节点内不可拖拽区域
  'nopan', // VueFlow：标记不触发画布平移的区域
  'ProseMirror-selectednode', // TipTap/ProseMirror 内部
]);

// 这些是 Tailwind utility，但单独编译不产出任何 CSS，长度探测会误判成业务 class：
//   group      —— 只是 group-* 变体的标记类
//   *-white    —— styles.css 的 @theme 用 `--color-*: initial` 清空了默认色板，
//                 所以 bg-white/text-white/border-white 在原项目里本就是空规则。
//                 仍要前缀化，否则宿主的 UnoCSS 会反过来给它们生成样式。
const TW_FORCE = new Set(['group', 'bg-white', 'text-white', 'border-white/15', 'border-white/20']);

/** 读取预先探测好的 token 分类结果。 */
function loadTokenSets() {
  const tw = new Set(JSON.parse(fs.readFileSync('/tmp/tw-tokens.json', 'utf8')));
  const biz = new Set(JSON.parse(fs.readFileSync('/tmp/biz-tokens.json', 'utf8')));
  for (const t of TW_FORCE) {
    biz.delete(t);
    tw.add(t);
  }
  for (const t of KEEP) biz.delete(t);
  return { tw, biz };
}

const { tw: TW_TOKENS, biz: BIZ_TOKENS } = loadTokenSets();

// 业务 class 里还有一批只出现在 :class 对象 key、任意变体选择器或 JS 值里，
// 静态 class="" 扫不到，这里显式补齐。
const EXTRA_BIZ = [
  // :class 对象 key / 数据驱动的状态值
  'active', 'approved', 'at-left', 'at-top', 'dragging', 'indeterminate',
  'is-open', 'open', 'selected', 'single',
  // 运行状态（由 runtimeStatus / step.status / statusClass() 产出）
  'succeeded', 'running', 'failed', 'pending', 'ready',
  'is-executing', 'is-failed', 'is-running', 'is-succeeded',
  // 聊天角色（由 message.role 产出）
  'assistant', 'user', 'tripo',
  // 组件内 <style> 里的语义 class
  'canvas-mode-select', 'canvas-mode-pan', 'flow-canvas', 'composer-editor',
  'tone-cyan', 'tone-violet', 'tone-amber', 'tone-green', 'tone-rose',
];
for (const t of EXTRA_BIZ) if (!KEEP.has(t)) BIZ_TOKENS.add(t);

/** 判断 token 是否已经带过前缀，避免脚本重复执行时叠加。 */
function alreadyPrefixed(token) {
  return token.startsWith(`${TW_PREFIX}:`) || token.startsWith(BIZ_PREFIX);
}

// Tailwind utility 的形态特征：用于兜底判断只出现在 :class 里、
// 未被静态 class="" 探测覆盖的 token（如 rotate-180、!border、hover:bg-x）。
const TW_SHAPE = /^!?[a-z][\w-]*(\[[^\]]*\])?([:/][^\s]*)?$/;
const TW_HEADS = new Set(['rotate', 'scale', 'translate', 'border', 'bg', 'text', 'flex', 'grid',
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'w', 'h', 'size', 'min', 'max', 'gap', 'rounded', 'shadow', 'opacity', 'z',
  'font', 'leading', 'tracking', 'items', 'justify', 'self', 'col', 'row',
  'absolute', 'relative', 'fixed', 'sticky', 'block', 'inline', 'hidden', 'overflow',
  'transition', 'duration', 'ease', 'animate', 'cursor', 'select', 'pointer', 'outline',
  'top', 'right', 'bottom', 'left', 'inset', 'order', 'basis', 'object', 'place',
  'whitespace', 'break', 'truncate', 'uppercase', 'lowercase', 'capitalize', 'underline',
  'backdrop', 'filter', 'blur', 'drop', 'stroke', 'fill', 'aspect', 'content',
  'hover', 'focus', 'active', 'disabled', 'dark', 'light', 'group', 'peer', 'first', 'last']);

/**
 * 改写选择器串里的 class 名，按「复合选择器」为单位判断归属。
 *
 * 必须按复合单位判断，不能逐个 `.token` 独立看：VueFlow 会自己往它的包裹元素上加
 * `selected` / `dragging` / `draggable`，而 Forge3D 的 CanvasNode 也有同名状态类
 * （已前缀化成 forge3d-selected）。两者同名但挂在不同元素上——
 * `.vue-flow__node.selected` 指的是 VueFlow 的元素，改名就选不中了；
 * 只看 `selected` 这一个 token 无法区分，得看它紧贴在谁后面。
 */
function rewriteSelectorClasses(selector) {
  // 按组合符（空格 > + ~ ,）切成复合单位，分隔符原样保留
  return selector.split(/(\s*[>+~,]\s*|\s+)/).map((unit) => {
    if (/^(\s*[>+~,]\s*|\s+)$/.test(unit)) return unit;
    // 复合单位里出现 vue-flow__ 就整段不动：同一元素上的状态类都归库所有
    if (unit.includes('vue-flow__')) return unit;
    return unit.replace(/\.([A-Za-z][\w-]*)/g, (dotted, name) => {
      if (KEEP.has(name) || name.startsWith(BIZ_PREFIX) || name.startsWith(`${TW_PREFIX}\\:`)) return dotted;
      return BIZ_TOKENS.has(name) ? `.${BIZ_PREFIX}${name}` : dotted;
    });
  }).join('');
}

/** 兜底判断一个未分类 token 是否长得像 Tailwind utility。 */
function looksLikeTailwind(token) {
  if (!TW_SHAPE.test(token)) return false;
  const head = token.replace(/^!/, '').split(/[-:/[]/)[0];
  return TW_HEADS.has(head);
}

/** 改写单个 class token；无法归类的原样返回并记入报告。 */
function rewriteToken(token, unknown) {
  if (!token || alreadyPrefixed(token) || KEEP.has(token)) return token;
  if (BIZ_TOKENS.has(token)) return BIZ_PREFIX + token;
  if (TW_TOKENS.has(token) || looksLikeTailwind(token)) {
    // 任意变体内部引用的业务 class 也要跟着改名，
    // 例如 [&.open_.wbg-label]:bg-x → forge:[&.forge3d-open_.forge3d-wbg-label]:bg-x
    const withInner = token.replace(/\[&([^\]]*)\]/g, (whole, inner) =>
      `[&${inner.replace(/\.([A-Za-z][\w-]*)/g, (dotted, name) =>
        KEEP.has(name) || name.startsWith(BIZ_PREFIX) ? dotted : `.${BIZ_PREFIX}${name}`)}]`);
    return `${TW_PREFIX}:${withInner}`;
  }
  unknown.add(token);
  return token;
}

/** 改写一整段 class 字符串（空白分隔的多个 token）。 */
function rewriteClassList(value, unknown) {
  return value.split(/(\s+)/).map(part => (/^\s+$/.test(part) ? part : rewriteToken(part, unknown))).join('');
}

const unknown = new Set();
const touched = [];
// 被改写成 bizClass() 调用、但可能还没 import 的文件，跑完提示人工补。
const needsBizImport = new Set();

/** 递归收集需要改写的源文件。 */
function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(vue|ts)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

for (const file of collect(SRC)) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;

  // 1) 静态 class="..." （含 <style> 之外的模板区域）
  after = after.replace(/(\sclass=)"([^"]*)"/g, (_, lead, value) =>
    `${lead}"${rewriteClassList(value, unknown)}"`);

  // 2) :class 对象字面量的 key —— { open: switcherOpen } → { 'forge3d-open': switcherOpen }
  //    key 可能是裸标识符（open）、带引号的 class 串（'at-top'），
  //    也可能是一整串带 ! 重要前缀的 utility（'!border !bg-[...]'）。
  after = after.replace(/:class="\{([^}]*)\}"/g, (whole, body) => {
    const next = body.replace(/(^|,)(\s*)(?:'([^']+)'|([A-Za-z][\w-]*))(\s*):/g,
      (seg, sep, ws, quoted, bare, tail) => {
        const key = quoted ?? bare;
        if (KEEP.has(key)) return seg;
        const renamed = rewriteClassList(key, unknown);
        if (renamed === key && !quoted) return seg;
        return `${sep}${ws}'${renamed}'${tail}:`;
      });
    return `:class="{${next}}"`;
  });

  // 3) :class="['a b', `tone-${x}`]" 数组里的字面量片段。
  //    带插值的模板串（`tone-${data.tone}`）也必须处理：只给 ${} 之前的静态前缀加前缀，
  //    插值部分是运行时值不能动。漏掉这类会让 <style> 里改过名的选择器匹配不上，
  //    表现为节点配色整体失效（--node-accent 取不到值，全部回落默认灰）。
  after = after.replace(/:class="\[([^\]]*)\]"/g, (whole, body) => {
    const next = body
      .replace(/'([^']*)'/g, (seg, value) => `'${rewriteClassList(value, unknown)}'`)
      .replace(/`([^`]*)`/g, (seg, value) => {
        // 模板串按 ${...} 切开，只改写静态片段
        const rewritten = value.replace(/^([A-Za-z][\w-]*?)(?=\$\{|$)/, (head) => {
          if (!head || KEEP.has(head) || head.startsWith(BIZ_PREFIX)) return head;
          return BIZ_PREFIX + head;
        });
        return `\`${rewritten}\``;
      });
    return `:class="[${next}]"`;
  });

  // 3.5) :class="cond ? 'a b' : 'c d'" 裸三元里的字面量。
  //      规则 3 只认 `[...]` 数组，这种形态整串漏掉，表现为按钮丢背景色与描边
  //      （实测 CanvasNode 的 Export / Generate / Run downstream 三个按钮丢了 accent 配色）。
  //
  //      难点是同一个三元里既有 class 串也有比较值：
  //        cond ? 'border-[#e05d5d] bg-[...]' : '...'   ← 要改
  //        { 'forge3d-active': mode === 'select' }      ← 'select' 是比较值，不能改
  //      靠位置区分：只改写「? 或 : 之后紧跟」的字面量，比较运算符右侧的一律跳过。
  after = after.replace(/:class="([^"]*)"/g, (whole, body) => {
    if (!body.includes('?')) return whole;
    const next = body.replace(/([?:]\s*)'([^']*)'/g, (seg, lead, value) =>
      `${lead}'${rewriteClassList(value, unknown)}'`);
    return `:class="${next}"`;
  });

  // 4) <style> 块里的 class 选择器 —— .canvas-node → .forge3d-canvas-node
  after = after.replace(/<style[^>]*>[\s\S]*?<\/style>/g, block =>
    // 只改选择器部分（`{` 之前），声明体里的 content: '.foo' 之类不能碰
    block.replace(/(^|[};])([^{};]*?)(?=\{)/g, (whole, lead, selector) =>
      lead + rewriteSelectorClasses(selector)));

  // 5) JS 侧直接给第三方库传的 class 字面量 —— TipTap editorProps.attributes.class 等。
  //    这类 class 不出现在模板里，只能在这里改；漏掉的表现是 CSS 规则存在但选择器命中不了
  //    （实测 .forge3d-composer-editor 的 font-size:12px 失效，编辑器字号回落 16px）。
  after = after.replace(/(\bclass: *)'([^']+)'/g, (whole, lead, value) => {
    const tokens = value.split(/\s+/);
    if (tokens.some(t => KEEP.has(t) || alreadyPrefixed(t))) return whole;
    if (!tokens.every(t => BIZ_TOKENS.has(t))) return whole;
    needsBizImport.add(file);
    return `${lead}bizClass('${value}')`;
  });

  // 6) JS 侧按 class 查询/比对 —— querySelector('.flow-canvas') 等
  after = after.replace(/(querySelector(?:All)?|closest|matches)\(\s*(['"`])([^'"`]*)\2\s*\)/g,
    (whole, fn, quote, selector) =>
      `${fn}(${quote}${rewriteSelectorClasses(selector)}${quote})`);

  if (after !== before) {
    touched.push(file);
    if (!process.argv.includes('--dry')) fs.writeFileSync(file, after);
  }
}

console.log(`改写文件 ${touched.length} 个`);
console.log(`Tailwind token ${TW_TOKENS.size} 个 → ${TW_PREFIX}:*`);
console.log(`业务 class ${BIZ_TOKENS.size} 个 → ${BIZ_PREFIX}*`);
console.log(`保持原名（第三方约定）：${[...KEEP].join(', ')}`);
const missingImport = [...needsBizImport].filter(f => !/from '.*class-prefix'/.test(fs.readFileSync(f, 'utf8')));
if (missingImport.length) {
  console.log(`\n⚠ 以下文件用到了 bizClass() 但没 import，需人工补 class-prefix：`);
  for (const f of missingImport) console.log('  ' + f);
}
if (unknown.size) {
  console.log(`\n⚠ 未归类的 token ${unknown.size} 个，需人工确认：`);
  console.log('  ' + [...unknown].sort().join(' '));
}
