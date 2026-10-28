import { createPortal } from 'react-dom'
import { Fragment } from 'react'
import { nextTick, state, watch, useSetup, cx, portalTarget } from '../store'


const SPEC = { props: ["open","title","initial"], emits: ["confirm","dismiss"] }

export default function NameDialog(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    const name = state('');
    const input = state<HTMLInputElement | null>(null);
    watch(() => props.open, open => {
      if (!open) return;
      name.value = props.initial;
      nextTick(() => {
        input.value?.focus();
        input.value?.select();
      });
    }, {
      immediate: true
    });
    function confirm() {
      const trimmed = name.value.trim();
      if (!trimmed) return;
      emit('confirm', trimmed);
    }
    return {
      name,
      input,
      confirm
    }
  })
  return (
    <>{createPortal(<>{(vm.open) ? (<div onClick={($event: any) => { if ($event.target !== $event.currentTarget) return; vm.emit('dismiss'); }} className={"forge:fixed forge:inset-0 forge:z-[1500] forge:grid forge:place-items-center forge:bg-bg-overlay forge:p-6 forge:backdrop-blur-[6px]"}><form role={"dialog"} aria-modal={"true"} aria-labelledby={"name-dialog-title"} onSubmit={($event: any) => { $event.preventDefault(); vm.confirm($event) }} className={"forge:grid forge:w-[min(400px,100%)] forge:gap-4 forge:rounded-[16px] forge:border forge:border-line-strong forge:bg-bg-card forge:p-6 forge:shadow-popover"}><header className={"forge:flex forge:items-start forge:justify-between forge:gap-3"}><h2 id={"name-dialog-title"} className={"forge:m-0 forge:text-[17px] forge:text-text-primary"}>{vm.title}</h2>
<button type={"button"} aria-label={"Cancel"} onClick={($event: any) => { vm.emit('dismiss'); }} className={"forge3d-bare forge:grid forge:size-8 forge:flex-none forge:place-items-center forge:rounded-full forge:border-0 forge:bg-transparent forge:text-xl forge:leading-none forge:text-text-muted forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid"}>{"×"}</button></header>
<label className={"forge:grid forge:gap-1.5 forge:text-[13px] forge:text-text-primary"}><span >{"Name"}</span>
<input ref={vm.$ref("input")} value={vm.name ?? ''} type={"text"} maxLength={"120"} autoComplete={"off"} onChange={($event: any) => { vm.name = $event.target.value }} className={"forge:h-10 forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-input forge:px-3 forge:text-[13px] forge:outline-none forge:focus:border-acid"} /></label>
<footer className={"forge:flex forge:justify-end forge:gap-2"}><button type={"button"} onClick={($event: any) => { vm.emit('dismiss'); }} className={"forge:h-9 forge:border forge:border-line-strong forge:bg-bg-input forge:px-4 forge:text-[13px] forge:text-text-secondary"}>{"Cancel"}</button>
<button type={"submit"} disabled={!vm.name.trim()} className={"forge:h-9 forge:border-0 forge:bg-acid forge:px-4 forge:text-[13px] forge:text-text-inverse"}>{"Create"}</button></footer></form></div>) : (null)}</>, portalTarget())}</>
  )
}
