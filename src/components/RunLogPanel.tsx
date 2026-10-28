import { Fragment } from 'react'
import { useSetup, cx } from '../store'
import { bizClass } from '../class-prefix';
import { formatDuration } from '../run-summary';

const SPEC = { props: ["details"], emits: ["close"] }

export default function RunLogPanel(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    
    return {
      bizClass,
      formatDuration
    }
  })
  return (
    <aside {...vm.$attrs} className={cx("forge:absolute forge:inset-x-0 forge:bottom-10 forge:z-[6] forge:grid forge:max-h-[210px] forge:grid-rows-[38px_minmax(0,1fr)] forge:border-t forge:border-line-strong forge:bg-bg-card forge:transition-colors forge:duration-200", vm.$attrs.className)} style={vm.$attrs.style}><header className={"forge:flex forge:items-center forge:justify-between forge:border-b forge:border-line forge:py-0 forge:pl-4 forge:pr-3"}><div ><span className={"forge:text-[12px] forge:font-semibold forge:text-acid"}>{"RUN LOG"}</span>
<b className={"forge:ml-[10px] forge:font-mono forge:text-[10px] forge:font-normal forge:text-text-muted forge:max-[900px]:hidden"}>{vm.details.id}
{" · "}
{vm.details.completed}
{"/"}
{vm.details.total}
{" steps · "}
{vm.formatDuration(vm.details.totalDurationMs)}</b></div>
<button type={"button"} aria-label={"Close run log"} onClick={($event: any) => { vm.emit('close'); }} className={"forge:size-[26px] forge:rounded forge:border-0 forge:bg-transparent forge:text-base forge:text-text-muted forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid"}>{"×"}</button></header>
<div className={"forge:grid forge:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] forge:gap-px forge:overflow-auto forge:bg-line forge:max-[900px]:block"}>{(vm.details.steps).map((step) => (<article key={step.id} className={cx("forge:grid forge:min-w-0 forge:grid-cols-[7px_minmax(0,1fr)_auto] forge:grid-rows-[auto_auto] forge:gap-x-2 forge:gap-y-0.5 forge:bg-bg-input forge:px-3 forge:py-[10px] forge:transition-colors forge:max-[900px]:border-b forge:max-[900px]:border-line forge:[&>i]:row-span-2 forge:[&>i]:self-center forge:[&>i]:size-1.5 forge:[&>i]:rounded-full forge:[&>i]:bg-text-muted forge:[&>div]:min-w-0 forge:[&_strong]:block forge:[&_strong]:overflow-hidden forge:[&_strong]:text-ellipsis forge:[&_strong]:whitespace-nowrap forge:[&_strong]:text-[11px] forge:[&_strong]:text-text-secondary forge:[&_small]:mt-[3px] forge:[&_small]:block forge:[&_small]:overflow-hidden forge:[&_small]:text-ellipsis forge:[&_small]:whitespace-nowrap forge:[&_small]:font-mono forge:[&_small]:text-[10px] forge:[&_small]:text-text-muted forge:[&>span]:font-mono forge:[&>span]:text-[10px] forge:[&>span]:font-medium forge:[&>span]:text-text-muted forge:[&>b]:col-start-3 forge:[&>b]:text-right forge:[&>b]:font-mono forge:[&>b]:text-[10px] forge:[&>b]:font-normal forge:[&>b]:text-text-secondary forge:[&.forge3d-succeeded>i]:bg-acid forge:[&.forge3d-running>i]:bg-status-running forge:[&.forge3d-failed>i]:bg-status-failed forge:[&.forge3d-failed>span]:text-status-failed forge:[&.forge3d-failed>b]:text-status-failed", vm.bizClass(step.status))}><i  />
<div ><strong >{step.label}</strong>
<small >{step.message}</small></div>
<span >{step.status}</span>
<b >{step.durationMs === null ? 'Pending' : vm.formatDuration(step.durationMs)}</b></article>))}</div></aside>
  )
}
