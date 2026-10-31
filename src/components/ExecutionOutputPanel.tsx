import { Fragment } from 'react'
import { derived, useSetup, cx } from '../store'
import { bizClass } from '../class-prefix';
import { apiUrl } from '../api'

const SPEC = { props: ["executions","loading","activeExecution","activeExecutions"], emits: [] }

export default function ExecutionOutputPanel(rawProps: any) {
  const vm = useSetup(rawProps, SPEC, (props, emit) => {
    // A running task is both polled (activeExecutions) and listed in the loaded
    // history (executions); keep one card per id, preferring the live copy.
    const taskRuns = derived(() => [...Object.values(props.activeExecutions || {}), ...(props.activeExecution?.id && !props.executions.some(execution => execution.id === props.activeExecution.id) ? [props.activeExecution] : []), ...props.executions].filter((execution, index, all) => !execution.id || all.findIndex(other => other.id === execution.id) === index).map(execution => ({
      ...execution,
      nodeExecutions: execution.nodeExecutions || execution.nodeRuns || {},
      outputs: Object.entries(execution.nodeExecutions || execution.nodeRuns || {}).flatMap(([nodeId, nodeRun]: [string, any]) => {
        const output = nodeRun.output || {};
        const files = output.outputs || (output.downloadUrl ? [output] : []);
        return files.filter((file: any) => file.downloadUrl).map((file: any) => ({
          ...file,
          nodeId,
          nodeName: nodeRun.nodeName || nodeId
        }));
      })
    })));
    function download(output: any) {
      const anchor = document.createElement('a');
      anchor.href = apiUrl(output.downloadUrl);
      anchor.download = output.filename || `output.${String(output.format || 'glb').toLowerCase()}`;
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    }
    function runLabel(execution: any) {
      return new Date(execution.createdAt).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    function statusLabel(status: string) {
      return ({
        queued: 'Queued',
        running: 'Running',
        cancelling: 'Stopping',
        cancelled: 'Cancelled',
        succeeded: 'Completed',
        failed: 'Failed'
      } as Record<string, string>)[status] || status;
    }
    
    // 把后端状态值转成带前缀的状态 class（前缀口径见 src/class-prefix.ts）
    function statusClass(status: string) {
      return bizClass(`is-${status}`);
    }
    function progress(execution: any) {
      const steps = Object.values(execution.nodeExecutions || {}) as any[];
      if (!steps.length) return 0;
      return Math.round(steps.filter(step => ['succeeded', 'failed', 'waiting_review'].includes(step.status)).length / steps.length * 100);
    }
    function parameterText(execution: any) {
      return Object.entries(execution.parameters || {}).flatMap(([nodeId, parameters]: [string, any]) => Object.entries(parameters || {}).filter(([key, value]) => key !== 'result' && value != null && ['string', 'number', 'boolean'].includes(typeof value)).map(([key, value]) => `${nodeId}.${key}: ${value}`)).join(' · ');
    }
    return {
      bizClass,
      taskRuns,
      download,
      runLabel,
      statusLabel,
      statusClass,
      progress,
      parameterText
    }
  })
  return (
    <aside {...vm.$attrs} aria-label={"Workflow tasks"} className={cx("forge3d-execution-output-panel forge:absolute forge:inset-y-0 forge:right-0 forge:z-20 forge:grid forge:w-[300px] forge:min-w-0 forge:translate-x-full forge:grid-rows-[58px_minmax(0,1fr)] forge:overflow-hidden forge:border-l forge:border-line forge:bg-bg-secondary forge:shadow-[-14px_0_30px_rgba(20,26,22,.12)] forge:transition-transform forge:duration-200 forge:[&.forge3d-is-open]:translate-x-0 forge:max-[1200px]:w-[270px] forge:max-[760px]:w-[min(300px,90vw)]", vm.$attrs.className)} style={vm.$attrs.style}><header className={"forge:flex forge:items-center forge:border-b forge:border-line forge:px-4"}><div className={"forge:grid forge:gap-1"}><span className={"forge:text-[12px] forge:font-semibold forge:text-acid"}>{"Queue"}</span>
<b className={"forge:font-mono forge:text-[10px] forge:font-normal forge:text-text-muted"}>{vm.taskRuns.length}
{" task"}
{vm.taskRuns.length === 1 ? '' : 's'}</b></div></header>
{(vm.loading) ? (<div className={"forge:m-3 forge:self-start forge:rounded-lg forge:border forge:border-dashed forge:border-line-strong forge:p-3.5 forge:font-mono forge:text-[11px] forge:leading-normal forge:text-text-muted"}>{"Loading outputs..."}</div>) : ((!vm.taskRuns.length) ? (<div className={"forge:m-3 forge:self-start forge:rounded-lg forge:border forge:border-dashed forge:border-line-strong forge:p-3.5 forge:font-mono forge:text-[11px] forge:leading-normal forge:text-text-muted"}>{"Run a node to add a task here."}</div>) : (<div className={"forge:grid forge:content-start forge:gap-3 forge:overflow-auto forge:p-3"}>{(vm.taskRuns).map((execution) => (<section key={execution.id} className={"forge:grid forge:gap-[7px] forge:rounded-lg forge:border forge:border-line forge:bg-bg-card forge:p-[10px]"}><div className={"forge:flex forge:items-baseline forge:justify-between forge:gap-2"}><strong className={"forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:text-[12px] forge:text-text-secondary"}>{execution.entryNodeName || 'Workflow run'}</strong>
<time dateTime={execution.createdAt} className={"forge:flex-none forge:font-mono forge:text-[10px] forge:text-text-muted"}>{vm.runLabel(execution)}</time></div>
<code title={execution.id} className={"forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:font-mono forge:text-[10px] forge:text-text-muted"}>{"Task ID: "}
{execution.id}</code>
{(vm.parameterText(execution)) ? (<p title={vm.parameterText(execution)} className={"forge:m-0 forge:line-clamp-3 forge:font-mono forge:text-[10px] forge:leading-[1.45] forge:text-text-muted"}>{vm.parameterText(execution)}</p>) : (null)}
<div className={cx("forge:flex forge:items-center forge:gap-1.5 forge:font-mono forge:text-[10px] forge:font-medium forge:text-text-muted forge:[&>i]:size-[7px] forge:[&>i]:rounded-full forge:[&>i]:bg-text-muted forge:[&>b]:ml-auto forge:[&>b]:font-medium forge:[&>b]:text-text-secondary forge:[&.forge3d-is-running>i]:animate-[execution-pulse_1.2s_ease-in-out_infinite] forge:[&.forge3d-is-running>i]:bg-acid forge:[&.forge3d-is-running>i]:shadow-[0_0_8px_color-mix(in_srgb,var(--acid)_70%,transparent)] forge:[&.forge3d-is-succeeded>i]:bg-[#68c987] forge:[&.forge3d-is-failed>i]:bg-[#e2746b]", vm.statusClass(execution.status))}><i aria-hidden={"true"} />
<span >{vm.statusLabel(execution.status)}</span>
<b >{vm.progress(execution)}
{"%"}</b></div>
<div className={"forge:mt-[7px] forge:h-[3px] forge:overflow-hidden forge:rounded-sm forge:bg-line"}><span className={"forge:block forge:h-full forge:bg-acid forge:transition-[width] forge:duration-250"} style={{
  width: `${vm.progress(execution)}%`
}} /></div>
{(execution.status === 'failed') ? (<p className={"forge:m-0 forge:font-mono forge:text-[10px] forge:font-normal forge:leading-[1.4] forge:text-[#e2746b]"}>{Object.values(execution.nodeExecutions || {}).find((nodeRun: any) => nodeRun.error)?.error}</p>) : (null)}
{(execution.outputs.length) ? (<div className={"forge:mt-2 forge:text-[12px] forge:font-semibold forge:text-text-muted"}>{"Outputs"}</div>) : (null)}
{(execution.outputs).map((output) => (<button key={`${output.nodeId}-${output.downloadUrl}`} type={"button"} onClick={($event: any) => { vm.download(output); }} className={"forge:[--btn-shadow:var(--acid-shadow)] forge:flex forge:w-full forge:items-center forge:justify-between forge:gap-2 forge:rounded-[5px] forge:border forge:border-line forge:bg-bg-input forge:p-2 forge:text-left forge:text-text-primary forge:transition-colors forge:hover:border-acid forge:hover:bg-[color-mix(in_srgb,var(--acid)_10%,var(--bg-input))]"}><span className={"forge:grid forge:min-w-0 forge:gap-[3px]"}><b className={"forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:font-mono forge:text-[11px] forge:font-medium"}>{output.filename || 'Generated output'}</b>
<small className={"forge:overflow-hidden forge:text-ellipsis forge:whitespace-nowrap forge:font-mono forge:text-[10px] forge:font-normal forge:text-text-muted"}>{output.nodeName}
{" · "}
{String(output.format || 'file').toUpperCase()}</small></span>
<i aria-hidden={"true"} className={"forge:font-mono forge:text-base forge:font-semibold forge:not-italic forge:leading-none forge:text-acid"}>{"↓"}</i></button>))}</section>))}</div>))}</aside>
  )
}
