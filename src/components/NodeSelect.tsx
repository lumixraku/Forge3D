import { Fragment } from 'react'
import { onBeforeUnmount, state, watch, useSetup, cx } from '../store'


const SPEC = { props: ["modelValue","options","dismissVersion"], emits: ["update:modelValue"], defaults: {
  dismissVersion: 0
} }

export default function NodeSelect(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    type SelectValue = string | number;
    type SelectOption = SelectValue | {
      value: SelectValue;
      label: string;
    };
    const open = state(false);
    const root = state<HTMLElement | null>(null);
    watch(() => props.dismissVersion, () => {
      open.value = false;
    });
    function closeOnOutsidePointerDown(event: PointerEvent) {
      if (open.value && !root.value?.contains(event.target as Node)) open.value = false;
    }
    watch(open, isOpen => {
      window[isOpen ? 'addEventListener' : 'removeEventListener']('pointerdown', closeOnOutsidePointerDown, true);
    });
    onBeforeUnmount(() => window.removeEventListener('pointerdown', closeOnOutsidePointerDown, true));
    function optionValue(option: SelectOption): SelectValue {
      return typeof option === 'object' ? option.value : option;
    }
    function optionLabel(option: SelectOption): string {
      return typeof option === 'object' ? option.label : option;
    }
    function select(option: SelectOption) {
      emit('update:modelValue', optionValue(option));
      open.value = false;
    }
    return {
      open,
      root,
      closeOnOutsidePointerDown,
      optionValue,
      optionLabel,
      select
    }
  })
  return (
    <div {...vm.$attrs} ref={vm.$ref("root")} className={cx("forge:relative", vm.$attrs.className)} style={vm.$attrs.style}><button type={"button"} aria-expanded={vm.open} aria-haspopup={"listbox"} onClick={($event: any) => { $event.stopPropagation(); vm.open = !vm.open; }} onPointerDown={($event: any) => { $event.stopPropagation() }} className={"forge:flex forge:h-7 forge:w-full forge:items-center forge:justify-between forge:rounded-[5px] forge:border forge:border-line-strong forge:bg-bg-input-hover forge:px-[7px] forge:text-left forge:font-mono forge:text-[11px] forge:text-text-primary forge:outline-0 forge:transition-[border-color,box-shadow] forge:duration-150 forge:hover:border-[var(--node-accent,#68d9d0)] forge:hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent,#68d9d0)_12%,transparent)] forge:aria-expanded:border-[var(--node-accent,#68d9d0)] forge:aria-expanded:shadow-[0_0_0_3px_color-mix(in_srgb,var(--node-accent,#68d9d0)_12%,transparent)]"}><span >{vm.optionLabel(vm.options.find(option => vm.optionValue(option) === vm.modelValue) ?? vm.modelValue)}</span>
<span className={cx("forge:inline-flex forge:text-xs forge:text-text-muted forge:transition-transform forge:duration-150", {
  'forge:rotate-180': vm.open
})}><svg viewBox={"0 0 16 16"} aria-hidden={"true"} className={"forge:block forge:size-[1em]"}><path d={"M4 6l4 4 4-4"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.6"} strokeLinecap={"round"} strokeLinejoin={"round"} /></svg></span></button>
{(vm.open) ? (<div role={"listbox"} onPointerDown={($event: any) => { $event.stopPropagation() }} className={"forge:absolute forge:left-0 forge:top-[calc(100%+5px)] forge:z-[1000] forge:grid forge:w-full forge:min-w-max forge:origin-top forge:overflow-hidden forge:rounded-[7px] forge:border forge:border-line-strong forge:bg-bg-input forge:p-1 forge:text-text-primary forge:shadow-popover forge:animate-[select-in_.12s_ease-out]"}>{(vm.options).map((option) => (<button key={vm.optionValue(option)} type={"button"} role={"option"} aria-selected={vm.optionValue(option) === vm.modelValue} onClick={($event: any) => { vm.select(option); }} className={cx("forge:relative forge:grid forge:h-7 forge:w-full forge:grid-cols-[13px_1fr] forge:items-center forge:rounded forge:px-2 forge:text-left forge:font-mono forge:text-[11px] forge:font-medium forge:text-text-secondary forge:outline-0 forge:transition-colors forge:duration-150 forge:select-none forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid forge:focus-visible:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:focus-visible:text-acid", {
  'forge:text-acid': vm.optionValue(option) === vm.modelValue
})}><span className={"forge:text-[12px]"}>{vm.optionValue(option) === vm.modelValue ? '✓' : ''}</span>
<span >{vm.optionLabel(option)}</span></button>))}</div>) : (null)}</div>
  )
}
