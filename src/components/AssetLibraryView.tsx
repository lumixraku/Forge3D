import { Fragment } from 'react'
import { useSetup, cx } from '../store'
import { apiUrl } from '../api'


const SPEC = { props: ["rails","total","loading","canvasNodeIds"], emits: ["preview","open-model-editor"] }

export default function AssetLibraryView(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    function scrollRail(event: MouseEvent, direction: number) {
      const track = (event.currentTarget as HTMLElement).closest('.forge3d-asset-rail')?.querySelector('.forge3d-asset-rail-track');
      track?.scrollBy({
        left: direction * Math.min(track.clientWidth * 0.85, 520),
        behavior: 'smooth'
      });
    }
    function onCanvas(nodeId: string) {
      return !props.canvasNodeIds || props.canvasNodeIds.includes(nodeId);
    }
    return {
      scrollRail,
      onCanvas
    }
  })
  return (
    <div {...vm.$attrs} className={cx("forge:row-start-1 forge:flex forge:min-h-0 forge:flex-col forge:gap-[22px] forge:overflow-y-auto forge:bg-bg-primary forge:px-5 forge:pb-[26px] forge:pt-[22px]", vm.$attrs.className)} style={vm.$attrs.style}>{(vm.loading && !vm.total) ? (<div className={"forge:m-auto forge:grid forge:max-w-[340px] forge:gap-1.5 forge:text-center"}><strong className={"forge:font-mono forge:text-xs forge:font-semibold forge:text-text-secondary"}>{"Loading assets…"}</strong>
<span className={"forge:text-xs forge:leading-normal forge:text-text-muted"}>{"Reading this canvas's run history."}</span></div>) : ((!vm.total) ? (<div className={"forge:m-auto forge:grid forge:max-w-[340px] forge:gap-1.5 forge:text-center"}><strong className={"forge:font-mono forge:text-xs forge:font-semibold forge:text-text-secondary"}>{"No assets yet"}</strong>
<span className={"forge:text-xs forge:leading-normal forge:text-text-muted"}>{"References, generated 2D images and 3D models from every run of this canvas collect here."}</span></div>) : (<>{(vm.rails).map((rail) => (<section key={rail.key} className={"forge3d-asset-rail forge:flex forge:flex-col forge:gap-[11px]"}><header className={"forge:flex forge:items-center forge:justify-between forge:border-b forge:border-line forge:pb-[9px]"}><div className={"forge:flex forge:items-baseline forge:gap-2"}><span className={"forge:text-[12px] forge:font-semibold forge:text-text-secondary"}>{rail.title}</span>
<b className={"forge:grid forge:h-4 forge:min-w-[18px] forge:place-items-center forge:rounded-lg forge:bg-bg-input-hover forge:px-[5px] forge:font-mono forge:text-[11px] forge:font-semibold forge:text-text-muted"}>{rail.items.length}</b></div>
{(rail.items.length) ? (<div className={"forge:flex forge:gap-[5px]"}><button type={"button"} aria-label={"Scroll left"} onClick={($event: any) => { vm.scrollRail($event, -1); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:grid forge:size-6 forge:place-items-center forge:rounded-md forge:border forge:border-acid-line forge:bg-bg-input forge:p-0 forge:text-sm forge:leading-none forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid"}>{"‹"}</button>
<button type={"button"} aria-label={"Scroll right"} onClick={($event: any) => { vm.scrollRail($event, 1); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:grid forge:size-6 forge:place-items-center forge:rounded-md forge:border forge:border-acid-line forge:bg-bg-input forge:p-0 forge:text-sm forge:leading-none forge:text-acid-dim forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid"}>{"›"}</button></div>) : (null)}</header>
{(rail.items.length) ? (<div className={"forge3d-asset-rail-track forge:flex forge:snap-x forge:snap-proximity forge:gap-3 forge:overflow-x-auto forge:pb-1.5 forge:[scrollbar-width:thin]"}>{(rail.items).map((item) => (<article key={item.id} className={"forge:group forge:relative forge:flex forge:w-[168px] forge:flex-none forge:snap-start forge:flex-col forge:gap-2 forge:rounded-[11px] forge:border forge:border-line forge:bg-bg-card forge:p-2 forge:transition-[border-color,box-shadow,transform] forge:duration-150 forge:hover:-translate-y-0.5 forge:hover:border-acid forge:hover:shadow-lg"}><button type={"button"} onClick={($event: any) => { vm.emit('preview', {
  src: item.src,
  alt: item.label
}); }} className={"forge:block forge:aspect-square forge:w-full forge:cursor-zoom-in forge:overflow-hidden forge:rounded-lg forge:border-0 forge:bg-bg-input-hover forge:p-0"}><img src={apiUrl(item.src)} alt={item.label} loading={"lazy"} className={"forge:block forge:size-full forge:object-cover"} /></button>
<div className={"forge:flex forge:items-center forge:justify-between forge:gap-1.5 forge:px-0.5"}><strong title={item.label} className={"forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:font-mono forge:text-[11px] forge:font-medium forge:text-text-primary"}>{item.label}</strong>
<span className={"forge:flex-none forge:rounded-[5px] forge:bg-bg-input-hover forge:px-1.5 forge:py-0.5 forge:font-mono forge:text-[10px] forge:font-semibold forge:text-text-muted"}>{rail.badge}</span></div>
<div className={"forge:flex forge:items-baseline forge:justify-between forge:gap-1.5 forge:px-0.5 forge:font-mono forge:text-[11px] forge:font-medium forge:text-text-muted"}><span title={item.runId} className={"forge:text-text-secondary"}>{item.runLabel}</span>
<time dateTime={item.createdAt} className={"forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap"}>{new Date(item.createdAt).toLocaleString()}</time></div>
{(rail.key === 'models' && vm.onCanvas(item.nodeId)) ? (<button type={"button"} title={"Open in Model Editor"} onClick={($event: any) => { vm.emit('open-model-editor', item.nodeId); }} className={"forge:absolute forge:right-3.5 forge:top-3.5 forge:grid forge:size-[26px] forge:place-items-center forge:rounded-[7px] forge:border-0 forge:bg-[color-mix(in_srgb,var(--bg-card)_82%,transparent)] forge:p-0 forge:text-[13px] forge:leading-none forge:text-text-secondary forge:opacity-0 forge:backdrop-blur forge:transition-[opacity,background,color] forge:group-hover:opacity-100 forge:hover:bg-acid forge:hover:text-text-inverse"}>{"↗"}</button>) : (null)}</article>))}</div>) : (<p className={"forge:px-0.5 forge:py-5 forge:font-mono forge:text-[12px] forge:font-medium forge:text-text-muted"}>{"No "}
{rail.title.toLowerCase()}
{" yet"}</p>)}</section>))}</>))}</div>
  )
}
