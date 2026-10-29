import { Fragment } from 'react'
import { useSetup, cx } from '../store'
import NodeCatalogMenu from "./NodeCatalogMenu";

const SPEC = { props: ["context","catalog","categories","canFrameSelection","canDissolveSelection","hasClipboard"], emits: ["frame-selection","dissolve-selection","rename","create-canvas","copy","cut","paste","duplicate","delete","select-node-type","drag-node-type"] }

export default function CanvasContextMenu(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    
    return {
      
    }
  })
  return (
    <div {...vm.$attrs} onPointerDown={($event: any) => { $event.stopPropagation() }} className={cx("forge3d-menu forge:fixed forge:left-0 forge:top-0 forge:z-30 forge:grid forge:max-h-[calc(100vh-16px)] forge:w-[260px] forge:gap-1.5 forge:overflow-y-auto forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-2 forge:shadow-popover forge:animate-[popover-in_.12s_ease-out] forge:[&>strong]:px-2.5 forge:[&>strong]:pb-0.5 forge:[&>strong]:pt-2 forge:[&>strong]:text-[12px] forge:[&>strong]:font-semibold forge:[&>strong]:text-text-muted forge:[&>button]:w-full forge:[&>button]:rounded-lg forge:[&>button]:border-0 forge:[&>button]:bg-transparent forge:[&>button]:px-2.5 forge:[&>button]:py-2 forge:[&>button]:text-left forge:[&>button]:text-xs forge:[&>button]:text-text-primary forge:[&>button]:transition-colors forge:[&>button]:hover:bg-[color-mix(in_srgb,var(--acid)_6%,var(--bg-input))]", vm.$attrs.className)} style={{ ...({
  left: `${vm.context.left}px`,
  top: `${vm.context.top}px`,
  maxWidth: `${vm.context.maxWidth}px`,
  maxHeight: `${vm.context.maxHeight}px`
}), ...(vm.$attrs.style) }}>{(vm.context.kind === 'selection') ? (<><strong >{"Selection"}</strong>
<button type={"button"} disabled={!vm.canFrameSelection} onClick={($event: any) => { vm.emit('frame-selection'); }} className={"forge3d-flat"}><span >{"Make as a section"}</span></button>
<button type={"button"} disabled={!vm.canDissolveSelection} onClick={($event: any) => { vm.emit('dissolve-selection'); }} className={"forge3d-flat"}><span >{"Dissolve section"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('create-canvas'); }} className={"forge3d-flat"}><span >{"Create canvas"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('copy'); }} className={"forge3d-flat"}><span >{"Copy"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('cut'); }} className={"forge3d-flat"}><span >{"Cut"}</span></button>
<button type={"button"} disabled={!vm.hasClipboard} onClick={($event: any) => { vm.emit('paste'); }} className={"forge3d-flat"}><span >{"Paste"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('duplicate'); }} className={"forge3d-flat"}><span >{"Duplicate selected"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('delete'); }} className={"forge3d-flat"}><span >{"Delete"}</span></button></>) : ((vm.context.kind === 'section') ? (<><strong >{"Section"}</strong>
<button type={"button"} onClick={($event: any) => { vm.emit('rename'); }} className={"forge3d-flat"}><span >{"Rename"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('dissolve-selection'); }} className={"forge3d-flat"}><span >{"Dissolve section"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('copy'); }} className={"forge3d-flat"}><span >{"Copy"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('cut'); }} className={"forge3d-flat"}><span >{"Cut"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('duplicate'); }} className={"forge3d-flat"}><span >{"Duplicate"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('create-canvas'); }} className={"forge3d-flat"}><span >{"Create canvas"}</span></button>
<button type={"button"} onClick={($event: any) => { vm.emit('delete'); }} className={"forge3d-flat"}><span >{"Delete section"}</span></button></>) : (<><strong >{"Canvas"}</strong>
<button type={"button"} disabled={!vm.hasClipboard} onClick={($event: any) => { vm.emit('paste'); }} className={"forge3d-flat"}><span >{"Paste"}</span></button>
<NodeCatalogMenu catalog={vm.catalog} categories={vm.categories} onSelect={($event: any) => { vm.emit('select-node-type', $event); }} onDragstart={($event: any) => { vm.emit('drag-node-type', $event); }} />
{(!vm.catalog.length) ? (<small className={"forge:px-[9px] forge:py-3 forge:text-text-muted"}>{"No compatible node types"}</small>) : (null)}</>))}</div>
  )
}
