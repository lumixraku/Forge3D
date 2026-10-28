import { Fragment } from 'react'
import { useSetup, cx } from '../store'


const SPEC = { props: [], emits: [] }

export default function NoAgentPanel(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    
    return {
      
    }
  })
  return (
    <>{(false) ? (<span  />) : (null)}</>
  )
}
