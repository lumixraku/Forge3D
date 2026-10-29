import { Fragment } from 'react'
import { nextTick, onMounted, onUnmounted, state, useSetup, cx } from '../store'


const SPEC = { props: ["activeCanvas","canvases","workspaceMode","canvasView","savedState","theme","busy","switcherOpen","editorName","canEdit","usingOwnKeys"], emits: ["rename","open-canvas","create-canvas","canvas-context-menu","import-file","set-theme","update:canvasView","update:switcherOpen","open-api-keys"] }

export default function TopBar(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    const renaming = state(false);
    const nameDraft = state('');
    const nameInput = state<HTMLInputElement | null>(null);
    const importInput = state<HTMLInputElement | null>(null);
    const importDragging = state(false);
    const switcherAnchor = state<HTMLElement | null>(null);
    function startRename() {
      if (!props.activeCanvas || props.busy || props.workspaceMode !== 'canvas') return;
      nameDraft.value = props.activeCanvas.name;
      renaming.value = true;
      nextTick(() => {
        nameInput.value?.focus();
        nameInput.value?.select();
      });
    }
    function commitRename() {
      if (!renaming.value) return;
      renaming.value = false;
      const name = nameDraft.value.trim();
      if (!props.activeCanvas || !name || name === props.activeCanvas.name) return;
      emit('rename', name);
    }
    function cancelRename() {
      renaming.value = false;
    }
    function importCanvas(event) {
      const [file] = event.target.files;
      event.target.value = '';
      if (file) emit('import-file', file);
    }
    function onImportDragOver(event: DragEvent) {
      event.preventDefault();
      importDragging.value = true;
    }
    function onImportDrop(event: DragEvent) {
      event.preventDefault();
      importDragging.value = false;
      const [file] = event.dataTransfer.files;
      if (file) emit('import-file', file);
    }
    function dismissSwitcher(event: PointerEvent) {
      if (!props.switcherOpen || switcherAnchor.value?.contains(event.target as Node)) return;
      emit('update:switcherOpen', false);
    }
    onMounted(() => window.addEventListener('pointerdown', dismissSwitcher, true));
    onUnmounted(() => window.removeEventListener('pointerdown', dismissSwitcher, true));
    return {
      renaming,
      nameDraft,
      nameInput,
      importInput,
      importDragging,
      switcherAnchor,
      startRename,
      commitRename,
      cancelRename,
      importCanvas,
      onImportDragOver,
      onImportDrop,
      dismissSwitcher
    }
  })
  return (
    <header {...vm.$attrs} className={cx("forge:relative forge:z-10 forge:grid forge:grid-cols-[350px_1fr_auto] forge:items-center forge:border-b forge:border-line-subtle forge:bg-bg-secondary forge:shadow-[0_2px_0_rgba(126,92,54,0.06)] forge:transition-colors forge:duration-200 forge:max-[1200px]:grid-cols-[310px_1fr_auto] forge:max-[760px]:sticky forge:max-[760px]:top-0 forge:max-[760px]:grid-cols-[auto_1fr]", vm.$attrs.className)} style={vm.$attrs.style}><div className={"forge:flex forge:h-full forge:items-center forge:gap-3 forge:border-r forge:border-line forge:px-[18px] forge:max-[760px]:border-r-0"}><span className={"forge3d-brand-mark forge:grid forge:place-items-center forge:w-[36px] forge:h-[36px] forge:rounded-[12px] forge:bg-acid forge:text-text-inverse forge:font-mono forge:font-semibold forge:text-xs forge:transition-all forge:duration-150 forge:hover:scale-105 forge:hover:shadow-[0_0_0_3px] forge:hover:shadow-acid/20"}>{"3D"}</span>
<div ><strong className={"forge:block forge:font-mono forge:font-semibold forge:text-sm forge:tracking-[-0.03em]"}>{"3d workflow"}</strong>
<small className={"forge:block forge:mt-[1px] forge:text-text-muted forge:text-[11px]"}>{"Conversational canvas studio"}</small></div></div>
{(!vm.activeCanvas) ? (<div onPointerDown={($event: any) => { $event.stopPropagation() }} className={"forge:relative forge:flex forge:min-w-0 forge:items-center forge:gap-3 forge:px-6"}><span className={"forge:flex-none forge:text-[12px] forge:font-semibold forge:text-text-muted"}>{"No canvas"}</span>
<div className={"forge:flex forge:min-w-0 forge:flex-[0_1_auto] forge:items-center"}><div ref={vm.$ref("switcherAnchor")} className={"forge:relative forge:flex-none"}><div className={cx("forge:flex forge:h-[34px] forge:flex-none forge:items-center forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:items-center forge:[&_button]:gap-1.5 forge:[&_button]:leading-none forge:[&_button]:rounded-none forge:[&_button:first-child]:rounded-l-lg forge:[&_button:last-child]:rounded-r-lg forge:[&_button+button]:-ml-px forge:[&_button]:border forge:[&_button]:[--btn-shadow:var(--acid-shadow)] forge:[&_button]:border-acid-line forge:[&_button]:bg-bg-input forge:[&_button]:px-3 forge:[&_button]:text-[12px] forge:[&_button]:font-medium forge:[&_button]:text-acid-dim forge:[&_button]:transition-colors forge:[&_button]:hover:border-acid forge:[&_button]:hover:text-acid forge:[&.forge3d-open_.forge3d-wbg-label]:border-acid forge:[&.forge3d-open_.forge3d-wbg-label]:text-acid forge:[&.forge3d-open_.forge3d-chevron-icon]:rotate-180", {
  'forge3d-open': vm.switcherOpen
})}><button type={"button"} aria-expanded={vm.switcherOpen} onClick={($event: any) => { vm.emit('update:switcherOpen', !vm.switcherOpen); }} className={"forge3d-wbg-label"}><span >{"Canvases"}</span>
<svg viewBox={"0 0 16 16"} aria-hidden={"true"} className={"forge3d-chevron-icon"}><path d={"M4 6l4 4 4-4"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.6"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></button>
<button type={"button"} disabled={vm.busy} onClick={($event: any) => { vm.emit('create-canvas'); }} className={"forge:!text-acid forge:!rounded-r-none"}>{"New"}</button></div>
{(vm.switcherOpen) ? (<div className={"forge3d-menu forge:absolute forge:left-0 forge:top-[calc(100%+8px)] forge:z-30 forge:flex forge:max-h-[min(70vh,520px)] forge:w-[300px] forge:flex-col forge:gap-1.5 forge:overflow-hidden forge:overflow-y-auto forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-2 forge:shadow-popover"}><div className={"forge:flex forge:items-center forge:justify-between forge:px-1.5 forge:pb-0.5 forge:pt-1"}><span className={"forge:text-[12px] forge:font-semibold forge:text-text-muted"}>{"Canvases · "}
{vm.canvases.length}</span></div>
<div className={"forge:flex forge:flex-col forge:gap-[3px] forge:overflow-auto"}><button type={"button"} disabled={vm.busy} onClick={($event: any) => { vm.emit('create-canvas'); }} className={"forge3d-flat forge:flex forge:w-full forge:items-center forge:gap-2 forge:rounded-lg forge:border-0 forge:bg-transparent forge:px-2.5 forge:py-2 forge:text-left forge:text-xs forge:font-semibold forge:text-acid forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_8%,transparent)] forge:disabled:opacity-50 forge:[&_svg]:size-3.5"}><svg viewBox={"0 0 16 16"} aria-hidden={"true"}><path d={"M8 3.5v9M3.5 8h9"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.6"} strokeLinecap={"round"} /></svg>
<span >{"New Project"}</span></button>
{(vm.canvases).map((canvas) => (<button key={canvas.id} onClick={($event: any) => { vm.emit('open-canvas', canvas.id); }} onContextMenu={($event: any) => { vm.emit('canvas-context-menu', {
  event: $event,
  canvas: canvas
}); }} className={"forge3d-flat forge:w-full forge:rounded-lg forge:border-0 forge:bg-transparent forge:px-2.5 forge:py-2 forge:text-left forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_6%,var(--bg-input))] forge:[&_small]:mt-[5px] forge:[&_small]:block forge:[&_small]:font-mono forge:[&_small]:text-[11px] forge:[&_small]:text-text-muted forge:[&_span]:text-xs"}><span >{canvas.name}</span>
<small >{canvas.nodeCount}
{" nodes · v"}
{canvas.revision}</small></button>))}
{(!vm.canvases.length) ? (<p className={"forge:mx-1 forge:mb-0 forge:mt-0.5 forge:font-mono forge:text-[11px] forge:leading-[1.5] forge:text-text-muted"}>{"No canvases yet. Press New to create one."}</p>) : (null)}</div></div>) : (null)}</div>
<button type={"button"} disabled={vm.busy} onClick={($event: any) => { vm.importInput.click(); }} onDragOver={($event: any) => { vm.onImportDragOver($event) }} onDragLeave={($event: any) => { vm.importDragging = false; }} onDrop={($event: any) => { vm.onImportDrop($event) }} className={cx("forge:[--btn-shadow:var(--acid-shadow)] forge:-ml-px forge:h-[34px] forge:rounded-l-none forge:rounded-r-lg forge:border forge:border-acid-line forge:bg-bg-input forge:px-3 forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] forge:hover:text-acid forge:[&.forge3d-dragging]:border-acid forge:[&.forge3d-dragging]:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] forge:[&.forge3d-dragging]:text-acid", {
  'forge3d-dragging': vm.importDragging
})}>{vm.importDragging ? 'Drop JSON' : 'Import JSON'}</button>
<input ref={vm.$ref("importInput")} type={"file"} accept={"application/json,.json"} onChange={($event: any) => { vm.importCanvas($event) }} className={"forge:hidden"} /></div></div>) : (<div onPointerDown={($event: any) => { $event.stopPropagation() }} className={"forge:relative forge:flex forge:min-w-0 forge:items-center forge:gap-3 forge:px-6"}><span className={"forge:flex-none forge:text-[12px] forge:font-semibold forge:text-text-muted"}>{vm.workspaceMode === 'canvas' ? 'Canvas' : 'Model editor'}
{" / "}
{vm.activeCanvas.revision.toString().padStart(2, '0')}</span>
{(vm.renaming) ? (<input ref={vm.$ref("nameInput")} value={vm.nameDraft ?? ''} type={"text"} onChange={($event: any) => { vm.nameDraft = $event.target.value }} onKeyDown={($event: any) => { (($event: any) => { if (!['Enter'].includes($event.key)) return; $event.preventDefault(); vm.commitRename($event) })($event); (($event: any) => { if (!['Escape'].includes($event.key)) return; $event.preventDefault(); vm.cancelRename($event) })($event) }} onBlur={($event: any) => { vm.commitRename($event) }} className={"forge:mt-[3px] forge:block forge:w-full forge:border-0 forge:bg-transparent forge:p-0 forge:text-sm forge:font-bold forge:leading-5 forge:shadow-[inset_0_-1px_0_var(--acid)] forge:outline-none"} />) : ((vm.workspaceMode === 'canvas') ? (<><div className={"forge:flex forge:min-w-0 forge:flex-[0_1_auto] forge:items-center forge:gap-3"}><strong title={"Double-click to rename"} onDoubleClick={($event: any) => { vm.startRename($event) }} className={"forge:min-w-0 forge:flex-[0_1_auto] forge:cursor-text forge:truncate forge:text-[15px] forge:font-extrabold"}>{vm.activeCanvas.name}</strong>
<div className={"forge:flex forge:flex-none forge:items-center"}><div ref={vm.$ref("switcherAnchor")} className={"forge:relative forge:flex-none"}><div className={cx("forge:flex forge:h-[34px] forge:flex-none forge:items-center forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:items-center forge:[&_button]:gap-1.5 forge:[&_button]:leading-none forge:[&_button]:rounded-none forge:[&_button:first-child]:rounded-l-lg forge:[&_button:last-child]:rounded-r-lg forge:[&_button+button]:-ml-px forge:[&_button]:border forge:[&_button]:[--btn-shadow:var(--acid-shadow)] forge:[&_button]:border-acid-line forge:[&_button]:bg-bg-input forge:[&_button]:px-3 forge:[&_button]:text-[12px] forge:[&_button]:font-medium forge:[&_button]:text-acid-dim forge:[&_button]:transition-colors forge:[&_button]:hover:border-acid forge:[&_button]:hover:text-acid forge:[&.forge3d-open_.forge3d-wbg-label]:border-acid forge:[&.forge3d-open_.forge3d-wbg-label]:text-acid forge:[&.forge3d-open_.forge3d-chevron-icon]:rotate-180", {
  'forge3d-open': vm.switcherOpen
})}><button type={"button"} aria-expanded={vm.switcherOpen} onClick={($event: any) => { vm.emit('update:switcherOpen', !vm.switcherOpen); }} className={"forge3d-wbg-label"}><span >{"Canvases"}</span>
<svg viewBox={"0 0 16 16"} aria-hidden={"true"} className={"forge3d-chevron-icon"}><path d={"M4 6l4 4 4-4"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.6"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></button>
<button type={"button"} disabled={vm.busy} onClick={($event: any) => { vm.emit('create-canvas'); }} className={"forge:!text-acid forge:!rounded-r-none"}>{"New"}</button></div>
{(vm.switcherOpen) ? (<div className={"forge3d-menu forge:absolute forge:left-0 forge:top-[calc(100%+8px)] forge:z-30 forge:flex forge:max-h-[min(70vh,520px)] forge:w-[300px] forge:flex-col forge:gap-1.5 forge:overflow-hidden forge:overflow-y-auto forge:rounded-xl forge:border forge:border-line-strong forge:bg-bg-input forge:p-2 forge:shadow-popover"}><div className={"forge:flex forge:items-center forge:justify-between forge:px-1.5 forge:pb-0.5 forge:pt-1"}><span className={"forge:text-[12px] forge:font-semibold forge:text-text-muted"}>{"Canvases · "}
{vm.canvases.length}</span></div>
<div className={"forge:flex forge:flex-col forge:gap-[3px] forge:overflow-auto"}><button type={"button"} disabled={vm.busy} onClick={($event: any) => { vm.emit('create-canvas'); }} className={"forge3d-flat forge:flex forge:w-full forge:items-center forge:gap-2 forge:rounded-lg forge:border-0 forge:bg-transparent forge:px-2.5 forge:py-2 forge:text-left forge:text-xs forge:font-semibold forge:text-acid forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_8%,transparent)] forge:disabled:opacity-50 forge:[&_svg]:size-3.5"}><svg viewBox={"0 0 16 16"} aria-hidden={"true"}><path d={"M8 3.5v9M3.5 8h9"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.6"} strokeLinecap={"round"} /></svg>
<span >{"New Project"}</span></button>
{(vm.canvases).map((canvas) => (<button key={canvas.id} onClick={($event: any) => { vm.emit('open-canvas', canvas.id); }} onContextMenu={($event: any) => { vm.emit('canvas-context-menu', {
  event: $event,
  canvas: canvas
}); }} className={cx("forge3d-flat forge:w-full forge:rounded-lg forge:border-0 forge:bg-transparent forge:px-2.5 forge:py-2 forge:text-left forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_6%,var(--bg-input))] forge:[&.forge3d-active]:bg-[color-mix(in_srgb,var(--acid)_12%,var(--bg-input))] forge:[&.forge3d-active_span]:font-semibold forge:[&.forge3d-active_span]:text-acid forge:[&_small]:mt-[5px] forge:[&_small]:block forge:[&_small]:font-mono forge:[&_small]:text-[11px] forge:[&_small]:text-text-muted forge:[&_span]:text-xs", {
  'forge3d-active': vm.activeCanvas?.id === canvas.id
})}><span >{canvas.name}</span>
<small >{canvas.nodeCount}
{" nodes · v"}
{canvas.revision}</small></button>))}</div>
<p className={"forge:mx-1 forge:mb-0 forge:mt-0.5 forge:font-mono forge:text-[11px] forge:leading-[1.5] forge:text-text-muted"}>{"Right-click a canvas for export, duplicate, or delete."}</p></div>) : (null)}</div>
<button type={"button"} disabled={vm.busy} onClick={($event: any) => { vm.importInput.click(); }} onDragOver={($event: any) => { vm.onImportDragOver($event) }} onDragLeave={($event: any) => { vm.importDragging = false; }} onDrop={($event: any) => { vm.onImportDrop($event) }} className={cx("forge:[--btn-shadow:var(--acid-shadow)] forge:-ml-px forge:h-[34px] forge:rounded-l-none forge:rounded-r-lg forge:border forge:border-acid-line forge:bg-bg-input forge:px-3 forge:text-[12px] forge:font-medium forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] forge:hover:text-acid forge:[&.forge3d-dragging]:border-acid forge:[&.forge3d-dragging]:bg-[color-mix(in_srgb,var(--acid)_8%,var(--bg-input))] forge:[&.forge3d-dragging]:text-acid", {
  'forge3d-dragging': vm.importDragging
})}>{vm.importDragging ? 'Drop JSON' : 'Import JSON'}</button>
<input ref={vm.$ref("importInput")} type={"file"} accept={"application/json,.json"} onChange={($event: any) => { vm.importCanvas($event) }} className={"forge:hidden"} /></div></div></>) : (<strong className={"forge:block forge:mt-[3px] forge:text-sm forge:truncate"}>{vm.activeCanvas.name}</strong>))}</div>)}
<div className={"forge:col-start-3 forge:flex forge:items-center forge:gap-2 forge:pr-4 forge:max-[760px]:col-start-auto forge:max-[760px]:justify-end forge:max-[760px]:pr-2"}>{(vm.workspaceMode === 'canvas') ? (<div role={"group"} aria-label={"Workspace view"} className={"forge:flex forge:h-[34px] forge:items-center forge:[&_button]:flex forge:[&_button]:h-full forge:[&_button]:items-center forge:[&_button]:justify-center forge:[&_button]:gap-[5px] forge:[&_button]:rounded-none forge:[&_button:first-child]:rounded-l-lg forge:[&_button:last-child]:rounded-r-lg forge:[&_button+button]:-ml-px forge:[&_button]:border forge:[&_button]:[--btn-shadow:var(--acid-shadow)] forge:[&_button]:border-acid-line forge:[&_button]:bg-bg-input forge:[&_button]:px-3 forge:[&_button]:text-[12px] forge:[&_button]:font-medium forge:[&_button]:text-acid-dim forge:[&_button]:transition-colors forge:[&_button]:hover:border-acid forge:[&_button]:hover:text-acid forge:[&_button.forge3d-active]:border-acid forge:[&_button.forge3d-active]:bg-acid forge:[&_button.forge3d-active]:text-text-inverse forge:[&_svg]:size-3 forge:[&_svg]:fill-current"}><button type={"button"} aria-pressed={vm.canvasView === 'canvas'} title={"Canvas"} onClick={($event: any) => { vm.emit('update:canvasView', 'canvas'); }} className={cx({
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
<span >{"Assets"}</span></button></div>) : (null)}
<span title={vm.editorName ? `${vm.editorName} is editing` : vm.savedState} className={"forge:w-[15ch] forge:truncate forge:text-right forge:font-mono forge:text-[11px] forge:text-text-muted forge:max-[1200px]:hidden"}>{vm.editorName ? `${vm.editorName} editing` : vm.canEdit ? `Editing · ${vm.savedState}` : vm.savedState}</span>
<div aria-label={"Theme"} className={"forge:flex forge:h-[34px] forge:max-[1200px]:hidden forge:[&_button]:h-full forge:[&_button]:rounded-none forge:[&_button:first-child]:rounded-l-lg forge:[&_button:last-child]:rounded-r-lg forge:[&_button+button]:-ml-px forge:[&_button]:border forge:[&_button]:[--btn-shadow:var(--acid-shadow)] forge:[&_button]:border-acid-line forge:[&_button]:bg-bg-input forge:[&_button]:px-3 forge:[&_button]:text-[12px] forge:[&_button]:font-medium forge:[&_button]:text-acid-dim forge:[&_button]:transition-colors forge:[&_button]:hover:border-acid forge:[&_button]:hover:text-acid forge:[&_button.forge3d-active]:border-acid forge:[&_button.forge3d-active]:text-acid"}>{(['light', 'dark', 'system']).map((option) => (<button key={option} aria-pressed={vm.theme === option} onClick={($event: any) => { vm.emit('set-theme', option); }} className={cx({
  'forge3d-active': vm.theme === option
})}>{option[0].toUpperCase() + option.slice(1)}</button>))}</div>
<button type={"button"} title={vm.usingOwnKeys ? 'Using your own API keys' : 'Using the demo API keys'} onClick={($event: any) => { vm.emit('open-api-keys'); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:flex forge:h-[34px] forge:items-center forge:gap-1.5 forge:whitespace-nowrap forge:rounded-lg forge:border forge:border-acid-line forge:bg-bg-input forge:px-3 forge:text-[12px] forge:text-acid-dim forge:hover:text-acid"}><i aria-hidden={"true"} className={cx("forge:size-[7px] forge:rounded-full", vm.usingOwnKeys ? 'forge:bg-acid' : 'forge:bg-text-muted')} />
{vm.usingOwnKeys ? 'Your keys' : 'API keys'}</button></div></header>
  )
}
