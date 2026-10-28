import { createPortal } from 'react-dom'
import { Fragment } from 'react'
import { nextTick, state, watch, useSetup, cx, portalTarget } from '../store'


const SPEC = { props: ["open","deepseekKey","meshyKey"], emits: ["save","dismiss"] }

export default function ApiKeysDialog(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    const deepseek = state('');
    const meshy = state('');
    const firstInput = state<HTMLInputElement | null>(null);
    watch(() => props.open, open => {
      if (!open) return;
      deepseek.value = props.deepseekKey;
      meshy.value = props.meshyKey;
      nextTick(() => firstInput.value?.focus());
    }, {
      immediate: true
    });
    function save() {
      emit('save', {
        deepseek: deepseek.value,
        meshy: meshy.value
      });
    }
    return {
      deepseek,
      meshy,
      firstInput,
      save
    }
  })
  return (
    <>{createPortal(<>{(vm.open) ? (<div onClick={($event: any) => { if ($event.target !== $event.currentTarget) return; vm.emit('dismiss'); }} onKeyDown={($event: any) => { if (!['Escape'].includes($event.key)) return; $event.stopPropagation(); vm.emit('dismiss'); }} className={"forge:fixed forge:inset-0 forge:z-[1500] forge:grid forge:place-items-center forge:bg-bg-overlay forge:p-6 forge:backdrop-blur-[6px]"}><form role={"dialog"} aria-modal={"true"} aria-labelledby={"api-keys-title"} aria-describedby={"api-keys-desc"} onSubmit={($event: any) => { $event.preventDefault(); vm.save($event) }} className={"forge:grid forge:w-[min(440px,100%)] forge:gap-4 forge:rounded-[16px] forge:border forge:border-line-strong forge:bg-bg-card forge:p-6 forge:shadow-popover"}><header className={"forge:flex forge:items-start forge:justify-between forge:gap-3"}><div ><h2 id={"api-keys-title"} className={"forge:m-0 forge:text-[17px] forge:text-text-primary"}>{"Use your own API keys"}</h2>
<p id={"api-keys-desc"} className={"forge:mb-0 forge:mt-1.5 forge:text-[13px] forge:leading-[1.5] forge:text-text-secondary"}>{"The copilot runs on DeepSeek and 3D generation on Meshy. Add your keys to use your own quota, or close this to try the demo keys."}</p></div>
<button type={"button"} aria-label={"Close and use the demo keys"} onClick={($event: any) => { vm.emit('dismiss'); }} className={"forge3d-bare forge:grid forge:size-8 forge:flex-none forge:place-items-center forge:rounded-full forge:border-0 forge:bg-transparent forge:text-xl forge:leading-none forge:text-text-muted forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))] forge:hover:text-acid"}>{"×"}</button></header>
<label className={"forge:grid forge:gap-1.5 forge:text-[13px] forge:text-text-primary"}><span className={"forge:flex forge:items-baseline forge:justify-between"}>{"DeepSeek API key "}
<a href={"https://platform.deepseek.com/api_keys"} target={"_blank"} rel={"noopener noreferrer"} className={"forge:text-[12px] forge:text-acid"}>{"Get a key"}</a></span>
<input ref={vm.$ref("firstInput")} value={vm.deepseek ?? ''} type={"password"} autoComplete={"off"} spellCheck={"false"} placeholder={"sk-..."} maxLength={"256"} onChange={($event: any) => { vm.deepseek = $event.target.value }} className={"forge:h-10 forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-input forge:px-3 forge:font-mono forge:text-[13px] forge:outline-none forge:focus:border-acid"} /></label>
<label className={"forge:grid forge:gap-1.5 forge:text-[13px] forge:text-text-primary"}><span className={"forge:flex forge:items-baseline forge:justify-between"}>{"Meshy API key "}
<a href={"https://www.meshy.ai/settings/api"} target={"_blank"} rel={"noopener noreferrer"} className={"forge:text-[12px] forge:text-acid"}>{"Get a key"}</a></span>
<input value={vm.meshy ?? ''} type={"password"} autoComplete={"off"} spellCheck={"false"} placeholder={"msy_..."} maxLength={"256"} onChange={($event: any) => { vm.meshy = $event.target.value }} className={"forge:h-10 forge:rounded-[10px] forge:border forge:border-line-strong forge:bg-bg-input forge:px-3 forge:font-mono forge:text-[13px] forge:outline-none forge:focus:border-acid"} /></label>
<p className={"forge:m-0 forge:text-[12px] forge:leading-[1.5] forge:text-text-muted"}>{"Keys stay in this browser. Each request passes them through this site's server to DeepSeek or Meshy; they are not saved on the server. Leave a field empty to use the demo key for it."}</p>
<footer className={"forge:flex forge:justify-end forge:gap-2"}><button type={"button"} onClick={($event: any) => { vm.emit('dismiss'); }} className={"forge:h-9 forge:border forge:border-line-strong forge:bg-bg-input forge:px-4 forge:text-[13px] forge:text-text-secondary"}>{"Use demo keys"}</button>
<button type={"submit"} className={"forge:h-9 forge:border-0 forge:bg-acid forge:px-4 forge:text-[13px] forge:text-text-inverse"}>{"Save keys"}</button></footer></form></div>) : (null)}</>, portalTarget())}</>
  )
}
