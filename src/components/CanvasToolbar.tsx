import { Fragment } from 'react'
import { useSetup, cx } from '../store'
import NodeCatalogMenu from "./NodeCatalogMenu";

const SPEC = { props: ["canvasView","canvasMode","nodeCount","edgeCount","selectedCount","assetLibrary","hasCanvas","isRunning","menuOpen","catalog","categories"], emits: ["update:canvasView","update:canvasMode","toggle-menu","select-node-type","drag-node-type","toggle-frame-mode","toggle-tie-mode","fit-view","auto-layout"] }

export default function CanvasToolbar(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    
    return {
      
    }
  })
  return (
    <div {...vm.$attrs} className={cx("forge:relative forge:z-[7] forge:row-start-2 forge:flex forge:min-h-0 forge:items-center forge:justify-between forge:gap-3 forge:border-t forge:border-line forge:bg-bg-secondary forge:px-[13px] forge:[&>div:last-child]:flex forge:[&>div:last-child]:items-center forge:[&>div:last-child]:gap-[5px] forge:[&>div:last-child]:min-w-0 forge:[&>div:last-child]:shrink forge:[&>div:last-child]:overflow-x-auto forge:[&>div:last-child]:py-1 forge:[&>div:last-child]:[scrollbar-width:none]", vm.$attrs.className)} style={vm.$attrs.style}><div className={"forge:flex forge:h-full forge:min-w-0 forge:items-center forge:gap-[9px] forge:whitespace-nowrap forge:font-mono forge:text-[10px] forge:font-medium forge:leading-none forge:text-text-muted"}><div role={"group"} aria-label={"Workspace view"} className={"forge:flex forge:h-[28px] forge:flex-none forge:items-center forge:rounded-full forge:border-0 forge:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:p-1 forge3d-bare forge3d-flat forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:min-w-[58px] forge:[&_button]:items-center forge:[&_button]:justify-center forge:[&_button]:gap-[5px] forge:[&_button]:border-0 forge:[&_button]:bg-transparent forge:[&_button]:[--btn-shadow:transparent] forge:[&_button]:px-[11px] forge:[&_button]:text-acid-dim forge:[&_button]:hover:bg-[color-mix(in_srgb,var(--acid)_16%,var(--bg-input))] forge:[&_button]:hover:text-acid forge:[&_button.forge3d-active]:bg-acid forge:[&_button.forge3d-active]:text-text-inverse forge:[&_button.forge3d-active]:shadow-[0_2px_0_0_var(--acid-dim,var(--acid))] forge:[&_svg]:size-3 forge:[&_svg]:fill-current forge:[&_span]:text-[11px] forge:[&_span]:font-semibold"}><button type={"button"} aria-pressed={vm.canvasView === 'canvas'} title={"Canvas"} onClick={($event: any) => { vm.emit('update:canvasView', 'canvas'); }} className={cx({
  'forge3d-active': vm.canvasView === 'canvas'
})}><svg viewBox={"0 0 16 16"} aria-hidden={"true"}><rect x={"2"} y={"2"} width={"5.2"} height={"5.2"} rx={"1.2"} />
<rect x={"8.8"} y={"2"} width={"5.2"} height={"5.2"} rx={"1.2"} />
<rect x={"2"} y={"8.8"} width={"5.2"} height={"5.2"} rx={"1.2"} />
<rect x={"8.8"} y={"8.8"} width={"5.2"} height={"5.2"} rx={"1.2"} /></svg>
<span >{"Canvas"}</span></button>
<button type={"button"} aria-pressed={vm.canvasView === 'assets'} title={"Asset library"} onClick={($event: any) => { vm.emit('update:canvasView', 'assets'); }} className={cx({
  'forge3d-active': vm.canvasView === 'assets'
})}><svg viewBox={"0 0 16 16"} aria-hidden={"true"}><rect x={"2"} y={"3.5"} width={"9"} height={"7"} rx={"1.4"} />
<rect x={"5"} y={"6"} width={"9"} height={"7"} rx={"1.4"} opacity={".5"} /></svg>
<span >{"Assets"}</span></button></div>
{vm.children}
{(vm.canvasView === 'assets') ? (<b className={"forge:block forge:max-[1200px]:hidden forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted"}>{vm.assetLibrary.total}
{" assets · "}
{vm.assetLibrary.reference.length}
{" reference · "}
{vm.assetLibrary.images.length}
{" 2D · "}
{vm.assetLibrary.models.length}
{" 3D"}</b>) : (<b className={"forge:block forge:max-[1200px]:hidden forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted"}>{vm.nodeCount}
{" nodes · "}
{vm.edgeCount}
{" connections · "}
{vm.selectedCount}
{" selected"}</b>)}</div>
<div >{(vm.canvasView === 'canvas') ? (<><div role={"group"} aria-label={"Canvas interaction mode"} className={"forge:flex forge:h-[28px] forge:items-center forge:gap-1 forge:rounded-full forge:border-0 forge:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:p-1 forge3d-bare forge3d-flat forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:min-w-[58px] forge:[&_button]:items-center forge:[&_button]:justify-center forge:[&_button]:gap-[5px] forge:[&_button]:border-0 forge:[&_button]:bg-transparent forge:[&_button]:[--btn-shadow:transparent] forge:[&_button]:px-[11px] forge:[&_button]:text-acid-dim forge:[&_button]:hover:bg-[color-mix(in_srgb,var(--acid)_16%,var(--bg-input))] forge:[&_button]:hover:text-acid forge:[&_button.forge3d-active]:bg-acid forge:[&_button.forge3d-active]:text-text-inverse forge:[&_button.forge3d-active]:shadow-[0_2px_0_0_var(--acid-dim,var(--acid))] forge:[&_svg]:size-3 forge:[&_svg]:fill-current forge:[&_span]:text-[11px] forge:[&_span]:font-semibold"}><button type={"button"} aria-pressed={vm.canvasMode === 'select'} title={"Select and marquee (V)"} onClick={($event: any) => { vm.emit('update:canvasMode', 'select'); }} className={cx({
  'forge3d-active': vm.canvasMode === 'select'
})}><svg viewBox={"0 0 16 16"} aria-hidden={"true"}><path d={"M3 1.8 12.3 9l-4.1.7 2.2 3.7-2.1 1.2-2.1-3.7L3 13.5Z"} /></svg>
<span >{"Select"}</span></button>
<button type={"button"} aria-pressed={vm.canvasMode === 'move'} title={"Move canvas (H)"} onClick={($event: any) => { vm.emit('update:canvasMode', 'move'); }} className={cx({
  'forge3d-active': vm.canvasMode === 'move'
})}><svg viewBox={"0 0 16 16"} aria-hidden={"true"}><path d={"M5.8 7V3.4a1 1 0 0 1 2 0V6h.4V2.8a1 1 0 0 1 2 0V6h.4V4a1 1 0 0 1 2 0v4.5l.5-.8a1 1 0 0 1 1.7 1l-2 3.5a3.3 3.3 0 0 1-2.9 1.7H8.3a3.3 3.3 0 0 1-2.8-1.6L3.2 8.5a1 1 0 0 1 1.7-1Z"} /></svg>
<span >{"Move"}</span></button></div>
<div className={"forge:relative"}><button disabled={!vm.hasCanvas} onClick={($event: any) => { vm.emit('toggle-menu'); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:text-acid"}>{"+ Add node"}</button>
{(vm.menuOpen) ? (<div onPointerDown={($event: any) => { $event.stopPropagation() }} className={"forge3d-menu forge:absolute forge:right-0 forge:bottom-[calc(100%+8px)] forge:z-30 forge:grid forge:max-h-[min(510px,calc(100vh-180px))] forge:w-[260px] forge:gap-1.5 forge:overflow-y-auto forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-2 forge:shadow-popover forge:animate-[popover-in_.12s_ease-out]"}><NodeCatalogMenu catalog={vm.catalog} categories={vm.categories} onSelect={($event: any) => { vm.emit('select-node-type', $event); }} onDragstart={($event: any) => { vm.emit('drag-node-type', $event); }} /></div>) : (null)}</div>
<button disabled={!vm.hasCanvas} aria-pressed={vm.canvasMode === 'frame'} title={"Draw a section on the canvas"} onClick={($event: any) => { vm.emit('toggle-frame-mode'); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid forge:aria-pressed:border-acid forge:aria-pressed:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:aria-pressed:text-acid"}>{"Section"}</button>
<button disabled={!vm.hasCanvas || !vm.edgeCount} aria-pressed={vm.canvasMode === 'tie'} title={"Cut across wires to tie them together"} onClick={($event: any) => { vm.emit('toggle-tie-mode'); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid forge:aria-pressed:border-acid forge:aria-pressed:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:aria-pressed:text-acid"}>{"Tie"}</button>
<button onClick={($event: any) => { vm.emit('fit-view'); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid"}>{"Fit"}</button>
<button disabled={!vm.nodeCount} onClick={($event: any) => { vm.emit('auto-layout'); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:h-[26px] forge:min-w-[26px] forge:rounded-full forge:border forge:border-acid-line forge:bg-bg-input forge:px-[12px] forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid"}>{"Auto layout"}</button></>) : (null)}</div></div>
  )
}
