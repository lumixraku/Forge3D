import { Fragment } from 'react'
import { derived, state, watch, useSetup, cx } from '../store'
import { bizClass } from '../class-prefix';
import type { RunProvider } from '../state/debugSettings';

const SPEC = { props: ["open","activeProvider","tripoAvailable","meshyAvailable","providerLocked","tripoNodeTypes","meshyNodeTypes","error","readCanvasJson"], emits: ["update:open","set-provider"] }

export default function DebugPanel(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    const PROVIDER_LABELS: Record<RunProvider, string> = {
      mock: 'Mock',
      tripo: 'Tripo API',
      meshy: 'Meshy API'
    };
    const activeProviderName = derived(() => PROVIDER_LABELS[props.activeProvider]);
    // The node types the active backend actually executes.
    const activeNodeTypes = derived(() => props.activeProvider === 'mock' ? [] : props.activeProvider === 'tripo' ? props.tripoNodeTypes : props.meshyNodeTypes);
    const providerDescription = derived(() => props.activeProvider === 'mock' ? 'Bound to Mock: executions return simulated data in the standard run format.' : `Bound to ${activeProviderName.value}: ${activeNodeTypes.value.join(', ')}. A missing API key fails the run; it never returns simulated data.`);
    const providers = derived(() => [{
      value: 'tripo' as const,
      label: 'Tripo API',
      available: props.tripoAvailable
    }, {
      value: 'mock' as const,
      label: 'Mock API',
      available: true
    }, {
      value: 'meshy' as const,
      label: 'Meshy API',
      available: props.meshyAvailable
    }]);
    type Corner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
    const CORNERS: Corner[] = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
    const STORAGE_KEY = 'forge3d.debugBallCorner';
    const MARGIN = 18;
    const BALL = 52;
    // Below this the gesture is a click, above it a drag, so a slightly unsteady
    // press still opens the panel.
    const DRAG_THRESHOLD = 4;
    function storedCorner(): Corner {
      try {
        const value = localStorage.getItem(STORAGE_KEY);
        return CORNERS.includes(value as Corner) ? value as Corner : 'bottom-left';
      } catch {
        // Private browsing or a blocked store; the default corner is fine.
        return 'bottom-left';
      }
    }
    const corner = state<Corner>(storedCorner());
    // Non-null only while dragging: the ball's top-left in viewport coordinates.
    const dragAt = state<{
      x: number;
      y: number;
    } | null>(null);
    const dragging = state(false);
    
    // While dragging the ball follows the pointer; otherwise it sits in its corner.
    // The panel opens away from the edges the ball is pinned to, so it stays on
    // screen in all four corners.
    // All four edges are always set: returning only `left`/`top` while dragging
    // would leave the docked `right`/`bottom` in place and pin the ball to two
    // opposite edges.
    const dockStyle = derived(() => {
      if (dragAt.value) {
        return {
          left: `${dragAt.value.x}px`,
          top: `${dragAt.value.y}px`,
          right: 'auto',
          bottom: 'auto'
        };
      }
      const [edgeY, edgeX] = corner.value.split('-');
      return {
        left: edgeX === 'left' ? `${MARGIN}px` : 'auto',
        right: edgeX === 'right' ? `${MARGIN}px` : 'auto',
        top: edgeY === 'top' ? `${MARGIN}px` : 'auto',
        bottom: edgeY === 'bottom' ? `${MARGIN}px` : 'auto'
      };
    });
    const atTop = derived(() => corner.value.startsWith('top'));
    const atLeft = derived(() => corner.value.endsWith('left'));
    function nearestCorner(x: number, y: number): Corner {
      const vertical = y + BALL / 2 < window.innerHeight / 2 ? 'top' : 'bottom';
      const horizontal = x + BALL / 2 < window.innerWidth / 2 ? 'left' : 'right';
      return `${vertical}-${horizontal}` as Corner;
    }
    function onPointerDown(event: PointerEvent) {
      // Only a primary press drags; let anything else fall through to the click.
      if (event.button !== 0) return;
      const ball = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const grabX = event.clientX - ball.left;
      const grabY = event.clientY - ball.top;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      const onMove = (move: PointerEvent) => {
        if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) < DRAG_THRESHOLD) return;
        moved = true;
        dragging.value = true;
        // Clamped so the ball cannot be dropped past an edge and stranded.
        dragAt.value = {
          x: Math.min(Math.max(move.clientX - grabX, MARGIN), window.innerWidth - BALL - MARGIN),
          y: Math.min(Math.max(move.clientY - grabY, MARGIN), window.innerHeight - BALL - MARGIN)
        };
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (dragAt.value) setCorner(nearestCorner(dragAt.value.x, dragAt.value.y));
        dragAt.value = null;
        // Cleared after the click handler runs, so a drag does not toggle the panel.
        requestAnimationFrame(() => {
          dragging.value = false;
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }
    function setCorner(next: Corner) {
      corner.value = next;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not remembering the corner does not stop it applying now.
      }
    }
    function onBallClick() {
      if (dragging.value) return;
      emit('update:open', !props.open);
    }
    const copyState = state<'idle' | 'copied' | 'failed'>('idle');
    // Reopening the panel should not show the outcome of a copy from a canvas that
    // may no longer be the open one.
    watch(() => props.open, () => {
      copyState.value = 'idle';
    });
    
    // Plain text, not the binary fragment format the canvas copy uses: this is for
    // reading and pasting elsewhere, so it has to arrive as JSON.
    async function copyCanvasJson() {
      const json = props.readCanvasJson();
      if (!json) {
        copyState.value = 'failed';
        return;
      }
      try {
        await navigator.clipboard.writeText(json);
        copyState.value = 'copied';
      } catch {
        copyState.value = 'failed';
      }
    }
    return {
      bizClass,
      PROVIDER_LABELS,
      activeProviderName,
      activeNodeTypes,
      providerDescription,
      providers,
      CORNERS,
      STORAGE_KEY,
      MARGIN,
      BALL,
      DRAG_THRESHOLD,
      storedCorner,
      corner,
      dragAt,
      dragging,
      dockStyle,
      atTop,
      atLeft,
      nearestCorner,
      onPointerDown,
      setCorner,
      onBallClick,
      copyState,
      copyCanvasJson
    }
  })
  return (
    <div {...vm.$attrs} className={cx("forge:fixed forge:z-[60] forge:flex forge:flex-col forge:items-start forge:gap-2.5 forge:pointer-events-none forge:[&.forge3d-at-top]:flex-col-reverse forge:[&:not(.forge3d-at-left)]:items-end forge:[&>*]:pointer-events-auto forge:[&.forge3d-dragging_.forge3d-debug-ball]:cursor-grabbing forge:[&.forge3d-dragging_.forge3d-debug-ball]:transform-none", {
  'forge3d-at-top': vm.atTop,
  'forge3d-at-left': vm.atLeft,
  'forge3d-dragging': vm.dragging
}, vm.$attrs.className)} style={{ ...(vm.dockStyle), ...(vm.$attrs.style) }}>{(vm.props.open) ? (<aside role={"dialog"} aria-label={"Debug settings"} className={"forge:w-[268px] forge:overflow-hidden forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-card forge:font-sans forge:shadow-popover"}><header className={"forge:flex forge:items-center forge:justify-between forge:border-b forge:border-line forge:px-3 forge:py-[9px] forge:font-mono forge:text-[12px] forge:font-semibold forge:tracking-[.08em] forge:text-text-secondary"}><span >{"DEBUG"}</span>
<button type={"button"} aria-label={"Close debug panel"} onClick={($event: any) => { vm.emit('update:open', false); }} className={"forge:border-0 forge:bg-transparent forge:text-[15px] forge:leading-none forge:text-text-muted forge:hover:text-acid"}>{"×"}</button></header>
<section className={"forge:p-3 forge:[&_h3]:mb-2 forge:[&_h3]:mt-0 forge:[&_h3]:font-mono forge:[&_h3]:text-[11px] forge:[&_h3]:font-semibold forge:[&_h3]:uppercase forge:[&_h3]:tracking-[.07em] forge:[&_h3]:text-text-muted"}><h3 >{"Active"}</h3>
<p className={cx("forge:m-0 forge:flex forge:items-center forge:gap-[7px] forge:text-xs forge:text-text-primary forge:[&_i]:size-[7px] forge:[&_i]:rounded-full forge:[&_i]:bg-text-muted forge:[&.forge3d-tripo_i]:bg-acid forge:[&.forge3d-tripo_i]:shadow-[0_0_6px_var(--acid)] forge:[&.forge3d-meshy_i]:bg-acid forge:[&.forge3d-meshy_i]:shadow-[0_0_6px_var(--acid)] forge:[&_b]:ml-auto forge:[&_b]:font-mono forge:[&_b]:text-[11px] forge:[&_b]:font-medium forge:[&_b]:tracking-[.04em] forge:[&_b]:text-acid", vm.bizClass(vm.props.activeProvider))}><i  />
<span >{vm.PROVIDER_LABELS[vm.props.activeProvider]}</span>
<b >{"spends credits"}</b></p>
<p className={"forge:mb-0 forge:mt-[7px] forge:text-[12px] forge:leading-[1.45] forge:text-text-muted"}>{vm.providerDescription}</p>
{(vm.props.error) ? (<p className={"forge:mb-0 forge:mt-[7px] forge:text-[12px] forge:leading-[1.45] forge:text-status-failed"}>{vm.props.error}</p>) : (null)}</section>
<section className={"forge:border-t forge:border-line-subtle forge:p-3 forge:[&_h3]:mb-2 forge:[&_h3]:mt-0 forge:[&_h3]:font-mono forge:[&_h3]:text-[11px] forge:[&_h3]:font-semibold forge:[&_h3]:uppercase forge:[&_h3]:tracking-[.07em] forge:[&_h3]:text-text-muted"}><h3 >{"Provider"}</h3>
<div className={"forge:grid forge:grid-cols-3 forge:gap-1.5"}>{(vm.providers).map((provider) => (<button key={provider.value} disabled={vm.props.providerLocked || !provider.available || provider.value === vm.props.activeProvider} type={"button"} onClick={($event: any) => { vm.emit('set-provider', provider.value); }} className={cx("forge:min-w-0 forge:rounded-md forge:border forge:border-line forge:bg-bg-input forge:px-1.5 forge:py-2 forge:text-[11px] forge:font-medium forge:text-text-secondary forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:disabled:cursor-not-allowed forge:disabled:opacity-40 forge:[&.forge3d-selected]:border-acid forge:[&.forge3d-selected]:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:[&.forge3d-selected]:text-acid", {
  'forge3d-selected': provider.value === vm.props.activeProvider
})}>{provider.label}</button>))}</div>
{(vm.props.providerLocked) ? (<small className={"forge:mt-1.5 forge:block forge:text-[11px] forge:text-text-muted"}>{"Provider is locked after the first node is added."}</small>) : (<small className={"forge:mt-1.5 forge:block forge:text-[11px] forge:text-text-muted"}>{"Unavailable providers need their API key configured."}</small>)}</section>
<section className={"forge:border-t forge:border-line-subtle forge:p-3 forge:[&_h3]:mb-2 forge:[&_h3]:mt-0 forge:[&_h3]:font-mono forge:[&_h3]:text-[11px] forge:[&_h3]:font-semibold forge:[&_h3]:uppercase forge:[&_h3]:tracking-[.07em] forge:[&_h3]:text-text-muted"}><h3 >{"Canvas"}</h3>
<button type={"button"} onClick={($event: any) => { vm.copyCanvasJson($event) }} className={"forge:flex forge:w-full forge:flex-col forge:gap-px forge:rounded-md forge:border forge:border-line forge:bg-bg-input forge:px-[9px] forge:py-[7px] forge:text-left forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:[&_strong]:text-xs forge:[&_strong]:font-medium forge:[&_strong]:text-text-primary forge:[&_small]:text-[12px] forge:[&_small]:text-text-muted"}><strong >{"Copy canvas JSON"}</strong>
<small >{vm.copyState === 'copied' ? 'Copied to clipboard' : vm.copyState === 'failed' ? 'Could not copy this canvas' : 'The open canvas document as text'}</small></button></section></aside>) : (null)}
<button type={"button"} aria-expanded={vm.props.open} aria-label={`Debug settings · running on ${vm.PROVIDER_LABELS[vm.props.activeProvider]} · drag to move`} onPointerDown={($event: any) => { vm.onPointerDown($event) }} onClick={($event: any) => { vm.onBallClick($event) }} className={cx("forge:[--btn-shadow:var(--acid-shadow)] forge3d-debug-ball forge:flex forge:size-[52px] forge:cursor-pointer forge:flex-col forge:items-center forge:justify-center forge:gap-0.5 forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-card forge:font-mono forge:text-[11px] forge:font-semibold forge:tracking-[.04em] forge:text-acid-dim forge:shadow-md forge:transition-[transform,border-color,color] forge:hover:-translate-y-px forge:hover:border-acid forge:hover:text-acid forge:[&.forge3d-open]:border-acid forge:[&.forge3d-open]:text-acid forge:[&_i]:size-[7px] forge:[&_i]:rounded-full forge:[&_i]:bg-text-muted forge:[&.forge3d-tripo_i]:bg-acid forge:[&.forge3d-tripo_i]:shadow-[0_0_6px_var(--acid)] forge:[&.forge3d-tripo]:text-text-primary forge:[&.forge3d-meshy_i]:bg-acid forge:[&.forge3d-meshy_i]:shadow-[0_0_6px_var(--acid)] forge:[&.forge3d-meshy]:text-text-primary", [vm.bizClass(vm.props.activeProvider), {
  'forge3d-open': vm.props.open
}])}><i  />
<span >{"API"}</span></button></div>
  )
}
