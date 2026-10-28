import { Fragment } from 'react'
import { useSetup, cx } from '../store'


const SPEC = { props: ["catalog","categories"], emits: ["select","dragstart"] }

export default function NodeCatalogMenu(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    
    return {
      
    }
  })
  return (
    <>{(vm.categories).map((category) => (<Fragment key={category}>{(vm.catalog.some(item => item.category === category)) ? (<strong className={"forge:px-2.5 forge:pb-0.5 forge:pt-2 forge:text-[12px] forge:font-semibold forge:text-text-muted"}>{category}</strong>) : (null)}
{(vm.catalog.filter(item => item.category === category)).map((item) => (<button key={item.type} type={"button"} draggable={"true"} onDragStart={($event: any) => { vm.emit('dragstart', {
  event: $event,
  type: item.type
}); }} onClick={($event: any) => { vm.emit('select', item.type); }} className={"forge3d-flat forge:grid forge:w-full forge:rounded-lg forge:border-0 forge:bg-transparent forge:px-2.5 forge:py-2 forge:text-left forge:transition-colors forge:hover:bg-[color-mix(in_srgb,var(--acid)_6%,var(--bg-input))]"}><span className={"forge:text-xs forge:text-text-primary"}>{item.label}</span>
<small className={"forge:mt-[5px] forge:block forge:font-mono forge:text-[11px] forge:font-normal forge:text-text-muted"}>{item.description}</small></button>))}</Fragment>))}</>
  )
}
