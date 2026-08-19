/**
 * 业务语义 class 的前缀口径。
 *
 * Forge3D 的样式类名统一带前缀，好让这套 UI 能安全嵌进别的宿主站点（如 fe-tripo-studio）
 * 而不与宿主的 CSS 互相覆盖。两套前缀分工：
 *   - Tailwind utility：`forge:` 变体前缀，由 styles.css 的 `prefix(forge)` 编译期生成
 *   - 业务语义 class：`forge3d-` 普通前缀，即本文件
 *
 * 模板里的字面量由 scripts/prefix-classes.mjs 批量改写；但那些**值来自后端**的
 * class（节点运行状态、消息角色、provider 名等）只能在运行时拼，所以走这个函数。
 */
export const BIZ_CLASS_PREFIX = 'forge3d-';

/** 给业务语义 class 加前缀；空值原样返回，避免拼出孤立的前缀串。 */
export function bizClass(name: string | null | undefined): string {
  return name ? BIZ_CLASS_PREFIX + name : '';
}
